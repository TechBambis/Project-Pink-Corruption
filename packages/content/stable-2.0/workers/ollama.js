// workers/ollama.js - Ollama Worker for BambiSleep Chat
const { parentPort } = require('worker_threads');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ENV = require('../config/env');

// Ollama Configuration Class with Graceful Degradation
class OllamaConfig {
    constructor() {
        this.isConfigured = false;
        this.errors = [];
        this.warnings = [];

        try {
            this.loadConfiguration();
        } catch (error) {
            console.warn('⚠️ Ollama configuration incomplete:', error.message);
            this.errors.push(error.message);
        }
    }

    loadConfiguration() {
        if (!ENV.OLLAMA.isConfigured) {
            throw new Error(`Ollama not configured for ${ENV.NODE_ENV} environment`);
        }

        this.OLLAMA_HOST = ENV.OLLAMA.HOST;
        this.OLLAMA_PORT = ENV.OLLAMA.PORT;
        this.MODEL = ENV.OLLAMA.MODEL;
        this.MAX_SEARCH_ATTEMPTS = ENV.OLLAMA.MAX_SEARCH_ATTEMPTS;
        this.OLLAMA_MODEL_LOAD_TIMEOUT = ENV.OLLAMA.MODEL_LOAD_TIMEOUT;
        this.OLLAMA_API_CALL_TIMEOUT = ENV.OLLAMA.API_CALL_TIMEOUT;
        this.OLLAMA_REST_API_TIMEOUT = ENV.OLLAMA.REST_API_TIMEOUT;
        this.SESSION_TIMEOUT = ENV.OLLAMA.SESSION_TIMEOUT_MINUTES * 60 * 1000;
        this.MAX_CONTEXT_TOKENS = ENV.OLLAMA.MAX_CONTEXT_TOKENS;
        this.MAX_COMPLETION_TOKENS = ENV.OLLAMA.MAX_COMPLETION_TOKENS;

        this.isConfigured = true;
        console.log('✅ Ollama configured for', ENV.NODE_ENV, 'environment');
    }

    getStatus() {
        return {
            configured: this.isConfigured,
            errors: this.errors,
            warnings: this.warnings,
            host: this.isConfigured ? this.OLLAMA_HOST : 'not-configured',
            port: this.isConfigured ? this.OLLAMA_PORT : 'not-configured'
        };
    }
}

// Prompt template manager — loads JSON files from workers/prompts/
class PromptManager {
    constructor(promptsDir) {
        this.promptsDir = promptsDir;
        this.prompts = {};
        this.defaultPromptId = null;
    }

    load() {
        this.prompts = {};
        this.defaultPromptId = null;
        try {
            if (!fs.existsSync(this.promptsDir)) {
                console.warn(`⚠️ Prompts directory not found: ${this.promptsDir}`);
                return;
            }
            const files = fs.readdirSync(this.promptsDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    const content = JSON.parse(fs.readFileSync(path.join(this.promptsDir, file), 'utf8'));
                    if (content.id) {
                        this.prompts[content.id] = content;
                        if (!this.defaultPromptId) this.defaultPromptId = content.id;
                        console.log(`📝 Loaded prompt: ${content.id} (${content.name})`);
                    }
                } catch (err) {
                    console.warn(`⚠️ Failed to load prompt file ${file}:`, err.message);
                }
            }
            if (this.prompts['bambisleep-classic']) this.defaultPromptId = 'bambisleep-classic';
            console.log(`✅ ${Object.keys(this.prompts).length} prompt(s) loaded. Default: ${this.defaultPromptId}`);
        } catch (error) {
            console.error('❌ Failed to load prompts:', error.message);
        }
    }

    list() {
        return Object.values(this.prompts).map(p => ({ id: p.id, name: p.name, description: p.description }));
    }

    get(id) {
        return this.prompts[id] || null;
    }

    build(id, vars) {
        const prompt = this.get(id);
        if (!prompt) return null;
        let result = this._sub(prompt.main || '', vars);
        if (vars.collar && prompt.collar_addon) result += this._sub(prompt.collar_addon, vars);
        if (prompt.strategy) result += this._sub(prompt.strategy, vars);
        return result;
    }

    _sub(template, vars) {
        return template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
            vars[key] !== undefined ? vars[key] : match
        );
    }

    hasPrompts() {
        return Object.keys(this.prompts).length > 0;
    }
}

// Initialize configuration
const config = new OllamaConfig();

// Initialize prompt manager
const promptManager = new PromptManager(path.join(__dirname, 'prompts'));
promptManager.load();

// Module-level config variables
let OLLAMA_HOST, OLLAMA_PORT, MODEL, MAX_SEARCH_ATTEMPTS;
let OLLAMA_MODEL_LOAD_TIMEOUT, OLLAMA_API_CALL_TIMEOUT, OLLAMA_REST_API_TIMEOUT, SESSION_TIMEOUT;
let MAX_CONTEXT_TOKENS, MAX_COMPLETION_TOKENS;

if (config.isConfigured) {
    OLLAMA_HOST = config.OLLAMA_HOST;
    OLLAMA_PORT = config.OLLAMA_PORT;
    MODEL = config.MODEL;
    MAX_SEARCH_ATTEMPTS = config.MAX_SEARCH_ATTEMPTS;
    OLLAMA_MODEL_LOAD_TIMEOUT = config.OLLAMA_MODEL_LOAD_TIMEOUT;
    OLLAMA_API_CALL_TIMEOUT = config.OLLAMA_API_CALL_TIMEOUT;
    OLLAMA_REST_API_TIMEOUT = config.OLLAMA_REST_API_TIMEOUT;
    SESSION_TIMEOUT = config.SESSION_TIMEOUT;
    MAX_CONTEXT_TOKENS = config.MAX_CONTEXT_TOKENS;
    MAX_COMPLETION_TOKENS = config.MAX_COMPLETION_TOKENS;
}

let currentModelId = null;
let modelSearchAttempts = 0;

if (config.isConfigured) {
    console.log(`🔧 Ollama config: ${process.env.NODE_ENV === 'production' ? 'PRODUCTION' : 'DEVELOPMENT'} mode`);
    console.log(`🔧 Ollama endpoint: http://${OLLAMA_HOST}:${OLLAMA_PORT}`);
    console.log(`🎯 Target model: ${MODEL}`);
    console.log(`⏱️  Timeouts - API: ${OLLAMA_API_CALL_TIMEOUT}ms, Model Load: ${OLLAMA_MODEL_LOAD_TIMEOUT}ms, REST API: ${OLLAMA_REST_API_TIMEOUT}ms`);
    console.log(`💾 Context Limits - Max Context: ${MAX_CONTEXT_TOKENS}, Max Completion: ${MAX_COMPLETION_TOKENS}`);
    console.log(`🔍 Max search attempts: ${MAX_SEARCH_ATTEMPTS}`);
    console.log(`⏲️  Session timeout: ${SESSION_TIMEOUT / 60000} minutes`);
} else {
    console.warn('⚠️ Ollama configuration incomplete - AI features disabled');
    console.warn('🔧 Configuration errors:', config.errors.join(', '));
}

// Session management
const sessionHistories = {};
let collar = false;
let collarText = '';
let triggerDescriptions = {};
let triggerData = {};

// Initialize trigger data from server (no direct file loading in worker)
function initializeTriggerData(serverTriggerData) {
    try {
        triggerDescriptions = {};
        triggerData = {};

        if (serverTriggerData && serverTriggerData.triggers && Array.isArray(serverTriggerData.triggers)) {
            serverTriggerData.triggers.forEach(trigger => {
                const triggerName = trigger.name.toUpperCase();

                triggerDescriptions[triggerName] = trigger.description;

                triggerData[triggerName] = {
                    id: trigger.id,
                    name: trigger.name,
                    category: trigger.category,
                    description: trigger.description,
                    effects: trigger.effects || [],
                    usage: trigger.usage,
                    safetyLevel: trigger.safetyLevel
                };
            });
        }

        console.log('🎯 Loaded OFFICIAL BambiSleep triggers from server API');
        console.log('📋 Source:', serverTriggerData.source, '| Version:', serverTriggerData.version);
        console.log('🏷️ Categories:', Object.keys(serverTriggerData.categories || {}));
        console.log('⚡ Available triggers:', Object.keys(triggerDescriptions));

    } catch (error) {
        console.error('CRITICAL: Failed to process trigger data from server:', error);
        triggerDescriptions = {};
        triggerData = {};
    }
}

// Worker message handling
if (parentPort) {
    parentPort.on('message', async (msg) => {
        try {
            if (['chat', 'auto_load_model'].includes(msg.type) && !config.isConfigured) {
                parentPort.postMessage({
                    type: 'error',
                    error: 'Ollama not configured - check environment variables',
                    configStatus: config.getStatus(),
                    socketId: msg.socketId
                });
                return;
            }

            switch (msg.type) {
                case 'chat':
                    await handleMessage(msg.prompt, msg.socketId, msg.username, msg.triggers || []);
                    break;

                case 'triggers':
                    if (msg.triggerData) {
                        initializeTriggerData(msg.triggerData);
                    }
                    console.log(`🎯 Worker trigger data initialized from server API`);
                    break;

                case 'collar':
                    collar = true;
                    collarText = msg.data;
                    console.log(`Worker collar activated: "${collarText.substring(0, 30)}..."`);
                    break;

                case 'auto_load_model':
                    await autoLoadBestModel();
                    break;

                case 'health':
                    parentPort.postMessage({
                        type: 'health_response',
                        healthy: config.isConfigured,
                        sessionCount: Object.keys(sessionHistories).length,
                        configStatus: config.getStatus()
                    });
                    break;

                default:
                    console.warn(`Unknown message type: ${msg.type}`);
            }
        } catch (error) {
            console.error('Worker error:', error);
            parentPort.postMessage({
                type: 'error',
                error: error.message,
                socketId: msg.socketId
            });
        }
    });
}

// Auto-load best available model matching the configured MODEL name
async function autoLoadBestModel() {
    try {
        console.log(`🔍 Searching for model matching "${MODEL}"...`);

        const availableModels = await getAvailableModels();
        if (!availableModels.length) {
            console.warn('⚠️ No models found in Ollama');
            return false;
        }

        const targetModels = findTargetModelVariants(availableModels);
        if (!targetModels.length) {
            console.warn(`⚠️ No variants of "${MODEL}" found in Ollama`);
            return false;
        }

        const bestModel = selectBestModelSize(targetModels);
        console.log(`✅ Selected model: ${bestModel.name} (${formatFileSize(bestModel.size)})`);

        const verified = await verifyModel(bestModel.name);
        if (verified) {
            currentModelId = bestModel.name;
            console.log(`🚀 Model ready: ${bestModel.name}`);

            if (parentPort) {
                parentPort.postMessage({
                    type: 'model_loaded',
                    modelId: bestModel.name,
                    modelSize: formatFileSize(bestModel.size)
                });
            }
            return true;
        } else {
            console.error(`❌ Model verification failed: ${bestModel.name}`);
            return false;
        }
    } catch (error) {
        console.error('❌ Auto-load model error:', error.message);
        return false;
    }
}

// Get available models from Ollama using /api/tags
async function getAvailableModels() {
    try {
        const apiUrl = `http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/tags`;

        const response = await axios.get(apiUrl, {
            timeout: OLLAMA_REST_API_TIMEOUT,
            headers: { 'Content-Type': 'application/json' }
        });

        return response.data?.models || [];
    } catch (error) {
        console.error('❌ Error fetching models from Ollama:', error.message);
        return [];
    }
}

// Find all variants of the target model by name
function findTargetModelVariants(models) {
    const targetLower = MODEL.toLowerCase();

    return models.filter(model => {
        const nameLower = (model.name || '').toLowerCase();
        // Strip optional :tag suffix for comparison
        const baseName = nameLower.split(':')[0];
        const targetBase = targetLower.split(':')[0];
        return baseName === targetBase || nameLower.includes(targetBase);
    });
}

// Select the best model size (prefer smaller for speed)
function selectBestModelSize(models) {
    if (!models.length) return null;
    return models.sort((a, b) => (a.size || 0) - (b.size || 0))[0];
}

// Verify a model is available in Ollama using /api/show
async function verifyModel(modelName) {
    try {
        const apiUrl = `http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/show`;

        const response = await axios.post(apiUrl, { name: modelName }, {
            timeout: OLLAMA_MODEL_LOAD_TIMEOUT,
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.status === 200) {
            console.log(`✅ Model "${modelName}" is available in Ollama`);
            return true;
        }
        return false;
    } catch (error) {
        if (error.response?.status === 404) {
            console.error(`❌ Model "${modelName}" not found in Ollama. Pull it with: ollama pull ${modelName}`);
        } else {
            console.error(`❌ Failed to verify model "${modelName}":`, error.message);
        }
        return false;
    }
}

// Format file size for display
function formatFileSize(bytes) {
    if (!bytes) return 'Unknown size';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

// Auto-detect and verify model on startup
async function initializeModelSystem() {
    try {
        const availableModels = await getAvailableModels();
        const exactMatch = availableModels.find(m => {
            const base = (m.name || '').split(':')[0].toLowerCase();
            return base === MODEL.toLowerCase() || m.name.toLowerCase() === MODEL.toLowerCase();
        });

        if (exactMatch) {
            console.log(`✅ Target model already available: ${exactMatch.name}`);
            currentModelId = exactMatch.name;
            if (parentPort) {
                parentPort.postMessage({
                    type: 'model_loaded',
                    modelId: exactMatch.name,
                    modelSize: formatFileSize(exactMatch.size)
                });
            }
            return;
        }

        const loaded = await autoLoadBestModel();
        if (!loaded) {
            console.error('❌ CRITICAL: Failed to find any matching model during initialization');
        }
    } catch (error) {
        console.error('❌ Model initialization error:', error.message);
    }
}

// Helper: Determine default triggers when the user has none selected
function getDefaultTriggers() {
    const primaryTriggers = [];
    const mentalTriggers = [];

    Object.values(triggerData).forEach((trigger) => {
        if (!trigger || !trigger.category || !trigger.name) return;

        const name = trigger.name.toUpperCase();
        const category = trigger.category.toLowerCase();

        if (category === 'primary') {
            primaryTriggers.push(name);
        } else if (category === 'mental') {
            mentalTriggers.push(name);
        }
    });

    const defaults = [];
    defaults.push(...primaryTriggers.slice(0, 2));
    if (mentalTriggers.length > 0) {
        defaults.push(mentalTriggers[0]);
    }

    if (defaults.length === 0) {
        return ['GOOD GIRL', 'BAMBI', 'SLEEP', 'OBEY', 'RELAX'];
    }

    return defaults;
}

// Core function: Generate system prompt using user-selected triggers
async function checkRole(collar, username, userSelectedTriggers, promptId = null) {
    const triggerArray = Array.isArray(userSelectedTriggers) ? userSelectedTriggers : [];
    const effectiveTriggers = triggerArray.length > 0 ? triggerArray : getDefaultTriggers();

    console.log(`🎯 Generating prompt for ${username} with triggers:`, effectiveTriggers);
    console.log(`✅ Total selected triggers: ${effectiveTriggers.length}`);

    const selectedTriggers = effectiveTriggers
        .map((name) => {
            const upperName = name.toUpperCase();
            const triggerInfo = triggerData[upperName];

            if (triggerInfo) {
                return `${upperName}: ${triggerInfo.description}`;
            } else {
                console.warn(`⚠️ Non-official trigger detected: ${upperName}`);
                return `${upperName}: Custom trigger.`;
            }
        })
        .filter(Boolean);

    if (selectedTriggers.length === 0) {
        console.warn(`⚠️ No triggers available for ${username}`);
        return `You are BambiSleep. Please select a trigger set to begin.`;
    }

    const triggerDescriptionPairs = selectedTriggers.join(' ');
    const selectedTriggerNames = triggerArray.map(t => t.toUpperCase()).join(', ');

    if (promptManager.hasPrompts()) {
        const effectiveId = promptId || promptManager.defaultPromptId;
        const vars = {
            username,
            selectedTriggerNames,
            triggerDescriptionPairs,
            collarName: collarText || 'COLLAR',
            collar
        };
        const built = promptManager.build(effectiveId, vars);
        if (built) {
            console.log(`📝 Using prompt template: ${effectiveId}`);
            return built;
        }
    }

    console.error('❌ No prompt templates loaded. Add JSON files to workers/prompts/ and restart or use /prompt reload.');
    return `You are BambiSleep. No prompt templates are loaded. Please add JSON files to workers/prompts/ and use /prompt reload.`;
}

// Handle /prompt chat commands
async function handlePromptCommand(command, socketId, username, currentTriggers = []) {
    const parts = command.trim().split(/\s+/);
    const subcommand = parts[1]?.toLowerCase();

    switch (subcommand) {
        case 'list': {
            const prompts = promptManager.list();
            if (prompts.length === 0) {
                sendResponse('No prompt files loaded. Add JSON files to workers/prompts/ and use /prompt reload.', socketId, username);
                return;
            }
            const currentId = sessionHistories[socketId]?.metadata?.promptId || promptManager.defaultPromptId;
            const lines = prompts.map(p =>
                `${p.id === currentId ? '\u25b6 ' : '  '}${p.id} \u2014 ${p.name}: ${p.description}`
            );
            sendResponse(`Available prompts:\n${lines.join('\n')}\n\nUse /prompt use <id> to switch.`, socketId, username);
            break;
        }
        case 'use': {
            const promptId = parts[2];
            if (!promptId) {
                sendResponse('Usage: /prompt use <id>. Use /prompt list to see available prompts.', socketId, username);
                return;
            }
            if (!promptManager.get(promptId)) {
                sendResponse(`Prompt "${promptId}" not found. Use /prompt list to see available prompts.`, socketId, username);
                return;
            }
            const triggers = sessionHistories[socketId]?.metadata?.lastTriggers || currentTriggers;
            const user = sessionHistories[socketId]?.metadata?.username || username;
            const createdAt = sessionHistories[socketId]?.metadata?.createdAt || Date.now();
            const systemPrompt = await checkRole(collar, user, triggers, promptId);
            const newSession = [];
            newSession.metadata = { createdAt, lastActivity: Date.now(), username: user, promptId, lastTriggers: triggers };
            newSession.push({ role: 'system', content: systemPrompt });
            sessionHistories[socketId] = newSession;
            const promptInfo = promptManager.get(promptId);
            sendResponse(`Switched to: ${promptInfo.name}\n${promptInfo.description}\n\nSession reset with new system prompt.`, socketId, username);
            break;
        }
        case 'info': {
            const currentId = sessionHistories[socketId]?.metadata?.promptId || promptManager.defaultPromptId;
            const current = promptManager.get(currentId);
            if (current) {
                sendResponse(`Current prompt: ${current.name} (${current.id})\n${current.description}`, socketId, username);
            } else {
                sendResponse('No prompt template loaded. Using built-in default.', socketId, username);
            }
            break;
        }
        case 'reload': {
            promptManager.load();
            const count = promptManager.list().length;
            sendResponse(`Reloaded prompts from disk. ${count} prompt(s) available.`, socketId, username);
            break;
        }
        default:
            sendResponse(
                'Prompt commands:\n' +
                '  /prompt list \u2014 show available prompts\n' +
                '  /prompt use <id> \u2014 switch prompt (resets session)\n' +
                '  /prompt info \u2014 show current prompt\n' +
                '  /prompt reload \u2014 reload prompt files from disk',
                socketId, username
            );
    }
}

// Handle chat messages
async function handleMessage(userPrompt, socketId, username, userSelectedTriggers = []) {
    try {
        if (userPrompt && userPrompt.trim().startsWith('/prompt')) {
            await handlePromptCommand(userPrompt.trim(), socketId, username, userSelectedTriggers);
            return;
        }

        if (!userPrompt || typeof userPrompt !== 'string' || userPrompt.trim().length === 0) {
            console.warn(`Invalid prompt from ${username}`);
            sendResponse("Sorry, I couldn't understand your message. Please try again.", socketId, username);
            return;
        }

        if (!currentModelId) {
            console.log('🔄 No model loaded, attempting auto-load...');
            const loaded = await autoLoadBestModel();

            if (!loaded) {
                console.error('❌ CRITICAL: Auto-load failed during chat request');
                sendResponse("Sorry, I'm having trouble finding the AI model. Please ensure Ollama is running and the model is pulled.", socketId, username);
                return;
            }
        }

        if (!sessionHistories[socketId]) {
            sessionHistories[socketId] = [];
            const initPromptId = promptManager.defaultPromptId;
            sessionHistories[socketId].metadata = {
                createdAt: Date.now(),
                lastActivity: Date.now(),
                username,
                promptId: initPromptId,
                lastTriggers: userSelectedTriggers
            };

            const systemPrompt = await checkRole(collar, username, userSelectedTriggers, initPromptId);
            sessionHistories[socketId].push({
                role: 'system',
                content: systemPrompt || collarText
            });
        }

        sessionHistories[socketId].metadata.lastActivity = Date.now();
        sessionHistories[socketId].metadata.username = username;
        sessionHistories[socketId].metadata.lastTriggers = userSelectedTriggers;

        sessionHistories[socketId].push({
            role: 'user',
            content: userPrompt
        });

        const apiUrl = `http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/chat`;

        let formattedMessages = sessionHistories[socketId]
            .filter(msg => msg && msg.role && msg.content)
            .map(msg => ({ role: msg.role, content: msg.content }));

        let estimatedTokens;

        if (sessionHistories[socketId].lastTokenUsage) {
            estimatedTokens = sessionHistories[socketId].lastTokenUsage.prompt_tokens;
            console.log(`📊 Using ACTUAL token count: ${estimatedTokens}, Max allowed: ${MAX_CONTEXT_TOKENS}`);
        } else {
            estimatedTokens = estimateTokenCount(formattedMessages);
            console.log(`📊 Using ESTIMATED token count: ${estimatedTokens}, Max allowed: ${MAX_CONTEXT_TOKENS}`);
        }

        if (estimatedTokens > MAX_CONTEXT_TOKENS) {
            console.log('⚠️ Context overflow detected, trimming conversation history...');
            formattedMessages = trimContextWindow(formattedMessages, MAX_CONTEXT_TOKENS);
            console.log(`📊 After trimming: ${estimateTokenCount(formattedMessages)} tokens`);
        }

        console.log(`Making API call to Ollama: ${apiUrl}`);
        console.log(`Messages count: ${formattedMessages.length}`);

        const streamResponse = await axios.post(apiUrl, {
            model: currentModelId,
            messages: formattedMessages,
            stream: true,
            think: false, // disable Qwen3 extended thinking to avoid multi-minute latency
            options: {
                temperature: 0.65,
                top_p: 0.85,
                repeat_penalty: 1.1,
                num_predict: MAX_COMPLETION_TOKENS,
            }
        }, {
            timeout: OLLAMA_API_CALL_TIMEOUT,
            responseType: 'stream',
            headers: { 'Content-Type': 'application/json' },
            httpAgent: new http.Agent({
                keepAlive: true,
                keepAliveMsecs: 30000,
            })
        });

        let fullContent = '';
        let sentenceBuffer = '';
        let actualTokenUsage = null;
        let lineBuffer = '';

        await new Promise((resolve, reject) => {
            streamResponse.data.on('data', (chunk) => {
                lineBuffer += chunk.toString();
                const lines = lineBuffer.split('\n');
                lineBuffer = lines.pop(); // keep last (potentially incomplete) line

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const json = JSON.parse(line);
                        if (json.done) {
                            if (json.prompt_eval_count != null || json.eval_count != null) {
                                actualTokenUsage = {
                                    prompt_tokens: json.prompt_eval_count || 0,
                                    completion_tokens: json.eval_count || 0,
                                    total_tokens: (json.prompt_eval_count || 0) + (json.eval_count || 0)
                                };
                            }
                            const remaining = sentenceBuffer.trim();
                            if (remaining) sendPartialResponse(remaining, socketId, username);
                            sentenceBuffer = '';
                            resolve();
                            return;
                        }
                        const token = json.message?.content || '';
                        fullContent += token;
                        sentenceBuffer += token;

                        const splitAt = findSentenceBoundary(sentenceBuffer);
                        if (splitAt > 0) {
                            const sentence = sentenceBuffer.substring(0, splitAt).trim();
                            sentenceBuffer = sentenceBuffer.substring(splitAt);
                            if (sentence) sendPartialResponse(sentence, socketId, username);
                        }
                    } catch (_) {
                        // skip malformed JSON line
                    }
                }
            });
            streamResponse.data.on('error', reject);
            streamResponse.data.on('end', () => {
                const remaining = sentenceBuffer.trim();
                if (remaining) sendPartialResponse(remaining, socketId, username);
                sentenceBuffer = '';
                resolve();
            });
        });

        if (!fullContent.trim()) {
            throw new Error('Ollama response missing assistant content');
        }

        sessionHistories[socketId].push({
            role: 'assistant',
            content: fullContent
        });

        if (actualTokenUsage) {
            sessionHistories[socketId].lastTokenUsage = actualTokenUsage;
        }

        const wordCount = countWords(fullContent);
        sendResponse(fullContent, socketId, username, wordCount, actualTokenUsage);

    } catch (error) {
        console.error(`Error in handleMessage: ${error.message}`);
        console.error(`Error details:`, error.response?.data || error.stack);

        if (error.code === 'ECONNREFUSED') {
            console.error('Ollama connection failed - is Ollama running?');
            sendResponse("Sorry, I'm having trouble connecting to the AI. Please make sure Ollama is running.", socketId, username);
        } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            console.error('Ollama request timed out');
            sendResponse("Sorry, the AI took too long to respond. Please try again.", socketId, username);
        } else if (error.code === 'ECONNRESET' || error.code === 'EPIPE' || error.code === 'ENOTCONN') {
            console.error('Ollama connection dropped:', error.code);
            sendResponse("Sorry, the connection to the AI was interrupted. Please try again.", socketId, username);
        } else if (error.response && error.response.status === 404) {
            console.error('Ollama model not found');
            sendResponse("Sorry, the AI model was not found. Please run: ollama pull " + (currentModelId || MODEL), socketId, username);
        } else if (error.response && error.response.status >= 500) {
            console.error('Ollama upstream service error');
            sendResponse("Sorry, the AI service returned an internal error. Please try again.", socketId, username);
        } else if (error.message && error.message.includes('missing assistant content')) {
            console.error('Ollama returned empty content - model may have exceeded token limit');
            sendResponse("Sorry, the AI returned an empty response. Please try again.", socketId, username);
        } else {
            console.error('Generic error caught, details:', error.message);
            sendResponse("Sorry, I encountered an error. Please try again.", socketId, username);
        }
    }
}

// Returns the index after the last sentence-ending punctuation + whitespace in text, -1 if none
function findSentenceBoundary(text) {
    const re = /[.!?]+\s+/g;
    let lastEnd = -1;
    let match;
    while ((match = re.exec(text)) !== null) {
        lastEnd = match.index + match[0].length;
    }
    return lastEnd;
}

// Emit a completed sentence to the main thread for immediate TTS delivery
function sendPartialResponse(sentence, socketId, username) {
    if (parentPort) {
        parentPort.postMessage({
            type: 'partial_response',
            response: sentence,
            socketId,
            username,
        });
    }
}

// Send response back to main thread
function sendResponse(response, socketId, username, wordCount = 0, tokenUsage = null) {
    if (parentPort) {
        const responseData = {
            type: 'response',
            response,
            socketId,
            username,
            wordCount
        };

        if (tokenUsage) {
            responseData.tokenUsage = tokenUsage;
        }

        parentPort.postMessage(responseData);
    }
}

// Helper function to estimate token count
function estimateTokenCount(messages) {
    if (!Array.isArray(messages)) return 0;

    let totalTokens = 0;
    for (const message of messages) {
        if (message.content) {
            const words = message.content.trim().split(/\s+/).length;
            const tokensFromWords = Math.ceil(words * 0.75);
            const specialTokens = (message.content.match(/[.!?;:]/g) || []).length;
            totalTokens += tokensFromWords + Math.ceil(specialTokens * 0.1);
        }
    }
    return totalTokens;
}

// Trim context window while preserving system message and recent context
function trimContextWindow(messages, maxTokens) {
    if (!Array.isArray(messages) || messages.length === 0) return [];

    const systemMessage = messages[0];
    const conversationMessages = messages.slice(1);

    let trimmedMessages = [systemMessage];
    let currentTokens = estimateTokenCount([systemMessage]);

    for (let i = conversationMessages.length - 1; i >= 0; i--) {
        const message = conversationMessages[i];
        const messageTokens = estimateTokenCount([message]);

        if (currentTokens + messageTokens <= maxTokens) {
            trimmedMessages.splice(1, 0, message);
            currentTokens += messageTokens;
        } else {
            console.log(`⚠️ Dropping message due to token limit: "${message.content?.substring(0, 50)}..."`);
            break;
        }
    }

    return trimmedMessages;
}

// Helper function to count words
function countWords(text) {
    if (!text || typeof text !== 'string') return 0;
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

// Garbage collection for session management
function collectGarbage() {
    const now = Date.now();
    let removed = 0;

    Object.keys(sessionHistories).forEach(socketId => {
        const session = sessionHistories[socketId];
        if (session.metadata && (now - session.metadata.lastActivity) > SESSION_TIMEOUT) {
            delete sessionHistories[socketId];
            removed++;
        }
    });

    if (removed > 0) {
        console.log(`Garbage collected ${removed} idle sessions`);
    }
}

setInterval(collectGarbage, 5 * 60 * 1000);

initializeModelSystem();

console.log('Ollama worker started and ready');

module.exports = { checkRole };
