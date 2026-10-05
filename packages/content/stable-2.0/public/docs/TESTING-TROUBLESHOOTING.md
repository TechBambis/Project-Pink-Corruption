# 🔧💕 Help!! Things Aren't Working!! 💕🔧

_OMG HIII sweetie!! Having troubles?? Don't cry!! Don't panic!! Bambi's got you and we're gonna fix everything together!! It's probably something super simple!!_ ✨🎀 *teehee most problems are fixed just by turning things off and on again like omg!!*

## 🌸 Quick Fixes (Try These First!! Seriously!!) 🌸

*Like 90% of problems are fixed by one of these!! Bambi's empty head can handle this!!* 💕

### Page Won't Load

**Try:**

1. Refresh the page (F5 or Ctrl+R)
2. Clear browser cache (Ctrl+Shift+Delete)
3. Try a different browser (Chrome or Edge!)
4. Check if server is running
5. Restart everything!

_Still broken? Keep reading!_ 💕

### Can't Connect to Chat

**Try:**

1. Check your internet connection
2. Look at the top - is it showing "Connected"?
3. Refresh the page
4. Check if server shows "Server Running" message
5. Try again in a minute!

### Features Not Working

**Try:**

1. Turn the feature OFF then ON again
2. Check if the button is green (enabled)
3. Look for error messages in browser console (F12)
4. Refresh the page
5. Clear localStorage (see below!)

## 🎀 Specific Problems 🎀

### 🔊 TTS Not Speaking

**Possible reasons:**

- TTS button is off (click to turn green!! That's step one!!)
- Volume is at 0% (turn up system volume omg!!)
- TTS server isn't running (developer stuff!!)
- Audio permissions denied (say yes when the browser asks!!)
- No messages to speak

**Fix it:**

1. Check TTS button is GREEN ✅
2. Turn up volume to 50%+
3. Click "Test Voice" in TTS menu
4. If no sound, check browser audio permissions!
5. Try a different voice

_Still quiet?? Server might be offline - ask someone smart!!_ 🔇

### 🤖 AI Not Responding

**Possible reasons:**

- AI Mode button is off (click it til it's pink!!)
- LM Studio isn't running (ask the server person!!)
- No AI model loaded
- Server connection lost
- Typing in wrong chat box (the AI one is the BOTTOM one!!)

**Fix it:**

1. Check AI Mode button is PINK 💕
2. Make sure you're typing in the AIGF box (the bottom pink one!!)
3. Wait 30 seconds - AI thinks slow sometimes, give her a moment!!
4. Check server console for errors
5. Restart LM Studio

_AI needs time to think!! Good things come to patient Bambis!!_ 💭

### 🌀 Spirals Not Showing

**Possible reasons:**

- Spiral button is off
- Canvas element blocked
- JavaScript error
- GPU issues
- Browser doesn't support p5.js

**Fix it:**

1. Click Spiral button (should turn green!)
2. Refresh page
3. Check browser console (F12) for errors
4. Try different browser
5. Update graphics drivers

_Spirals need GPU power!_ 💫

### 🎯 Triggers Not Detecting

**Possible reasons:**

- Triggers button is off
- No triggers selected
- Messages don't contain trigger words
- JavaScript error

**Fix it:**

1. Check Triggers button is GREEN
2. Open trigger menu and select some!
3. Use test triggers: "Good Girl", "Bambi"
4. Check browser console for errors
5. Refresh page

_Need to enable AND select triggers!_ ✨

### 🔌 Device Won't Connect

**Browser Mode:**

- Bluetooth is off → Turn on Bluetooth!
- Device not in pairing mode → Hold power button!
- Too far away → Move closer!
- Wrong browser → Use Chrome or Edge!
- Already paired to something else → Unpair it!

**Intiface Mode:**

- Intiface Central not running → Start it!
- Server not started → Click "Start Server"!
- Wrong port → Should be 12345!
- Firewall blocking → Allow through firewall!

_Check device battery too!_ 🔋

### 🧠 Brainwaves Not Playing

**Possible reasons:**

- Brainwaves button is off
- No preset selected
- Volume at 0%
- Not using headphones
- Audio context blocked

**Fix it:**

1. Check Brainwaves button is GREEN
2. Select a preset from dropdown
3. Click ▶ Start button
4. PUT ON HEADPHONES! (Required!)
5. Turn up volume

_Binaural beats NEED headphones!_ 🎧

## 💖 Browser Console (F12) 💖

**How to check for errors:**

1. Press **F12** on keyboard
2. Click **Console** tab
3. Look for RED errors
4. Copy error message
5. Search online or ask for help!

**Common errors:**

- `404 Not Found` → Server offline or wrong URL
- `WebSocket failed` → Connection issues
- `Undefined` → Missing data
- `CORS error` → Server configuration issue

## 🌺 Clear Everything & Start Fresh 🌺

**If nothing works, reset:**

1. Open browser console (F12)
2. Type: `localStorage.clear()`
3. Press Enter
4. Refresh page (F5)
5. Everything resets to defaults!

**Warning:** This deletes ALL saved settings! 💕

## 🔧 Developer Problems 🔧

### Server Won't Start

**Check:**

- Node.js installed? (Need v18+)
- Dependencies installed? (`npm install`)
- Port 6969 available?
- .env file exists?
- All files present?

**Fix:**

```bash
# Reinstall everything
npm run clean
npm install
npm start
```

### External Services

**Kokoro TTS:**

- Check server is running on configured port
- Verify host/port in .env
- Test with curl/Postman

**LM Studio:**

- Open LM Studio app
- Load a model
- Start server
- Check port matches .env

### Tests Failing

**Run tests:**

```bash
npm test
```

**Check reports:**

- Look in `tests/reports/`
- Open HTML report in browser
- Check `latest-unified-summary.txt`

_Tests help developers find bugs!_ 🐛

## 🌟 Still Stuck? 🌟

**Get help:**

1. Check the other docs for your feature
2. Look at GitHub issues
3. Ask in community
4. Check server console for errors
5. Try on different device

**Provide this info when asking:**

- What you tried to do
- What actually happened
- Error messages (from F12 console)
- Browser & version
- Steps to reproduce

_We'll help you fix it!_ 💕✨

---

_Most problems are fixed by refreshing or restarting! Don't give up!_ 🎀

**Solutions:**

1. **Check server logs manually:**

```bash
node server.js
# Look for error messages
```

2. **Increase timeout (if needed):**
   Edit `tests/stability.test.js`:

```javascript
// Change from 10000 to 15000
setTimeout(() => {
  // ...
}, 15000);
```

3. **Run without external services:**

```bash
# Use CI mode to skip external service tests
npm run test:ci
```

### ❌ WebSocket connection failures

**Error:** `Concurrent connections: 0/10`

**Causes:**

- Socket.io not properly configured
- CORS issues
- Server not fully started

**Solutions:**

1. **Check CORS configuration in server.js:**

```javascript
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});
```

2. **Test WebSocket manually:**

```bash
# Install wscat if needed
npm install -g wscat

# Test connection
wscat -c ws://localhost:6969/socket.io/?EIO=4&transport=websocket
```

### ❌ HTTP connectivity failures

**Error:** `✗ http://localhost:6969 failed: ECONNREFUSED`

**Causes:**

- Server not running
- Wrong port
- Firewall blocking connection

**Solutions:**

1. **Verify server is running:**

```bash
# Check if port is listening
netstat -an | findstr :6969  # Windows
lsof -i :6969                # Linux/macOS
```

2. **Check firewall:**

```bash
# Windows - allow Node through firewall
# Control Panel → Windows Defender Firewall → Allow an app

# Linux
sudo ufw allow 6969
```

### ⚠️ Memory growth warnings

**Warning:** `Memory growth: 51.2 MB`

**Causes:**

- Memory leak in application code
- Long-running processes not cleaned up
- Too many connections retained

**Solutions:**

1. **Review worker thread cleanup:**
   Check that workers are properly terminated in `server.js`

2. **Monitor in production:**

```bash
# Use Node's built-in profiler
node --inspect server.js

# Open Chrome DevTools → Memory profiler
```

---

## Resource Test Failures

### ❌ Insufficient CPU data collected

**Error:** `Insufficient CPU data collected`

**Causes:**

- Tests running too fast
- Windows CPU monitoring limitations
- High system load

**Solutions:**

1. **This is often a non-critical warning** - tests run quickly
2. **Increase monitoring duration:**
   Edit `tests/resource.test.js`:

```javascript
const testDuration = 20000; // Increase from 15000
```

3. **Run on Linux/macOS for better metrics:**

```bash
# Linux has better CPU profiling support
```

### ⚠️ Port test timeout

**Warning:** `Port 5173 test timeout`

**Causes:**

- Services already running on ports
- Network slowness
- Firewall interference

**Solutions:**

1. **These timeouts are often harmless** - just means something is using the port
2. **To fix, free the ports:**

```bash
# Stop all development servers before testing
npm run test
```

### ❌ High memory usage

**Error:** `Average memory usage: 520 MB` (threshold: 500 MB)

**Solutions:**

1. **Close other applications** during testing
2. **Increase threshold if your system has plenty of RAM:**
   Edit `tests/resource.test.js`:

```javascript
avgMemMB < 600 ? "pass" : "warn"; // Increase from 500
```

---

## CI/CD Issues

### ❌ GitHub Actions failing

**Error:** Tests pass locally but fail in CI

**Common causes:**

1. **Missing environment variables:**

```yaml
# Add to .github/workflows/test.yml
env:
  CI: true
  NODE_ENV: test
```

2. **External services unavailable:**

```bash
# Use CI mode to skip external tests
npm run test:ci
```

3. **Timeout issues in CI:**
   CI environments are often slower. Adjust timeouts:

```yaml
# In workflow file
timeout-minutes: 15 # Increase if needed
```

### ❌ Artifact upload fails

**Error:** `No files found in tests/reports/`

**Solutions:**

1. **Ensure reports directory exists:**

```yaml
- name: Create reports directory
  run: mkdir -p tests/reports
```

2. **Check test execution:**

```yaml
- name: Run tests
  run: npm test
  continue-on-error: true # Generate reports even on failure
```

---

## External Service Issues

### 🔇 Kokoro TTS not available

**Error:** `🎤 Kokoro API or worker not configured, TTS routes will return 503`

**This is normal if you don't have Kokoro TTS running.**

**Solutions:**

1. **Run without TTS (app still works):**

- TTS features will be disabled
- Chat and other features work normally

2. **Install Kokoro TTS locally:**

```bash
# Follow Kokoro installation guide
# Set in .env:
KOKORO_HOST_DEVELOPMENT=http://localhost
KOKORO_PORT=8880
```

3. **Run tests in CI mode:**

```bash
npm run test:ci  # Skips external services
```

### 🤖 LM Studio not available

**Error:** `❌ Error fetching models: Error`

**This is normal if you don't have LM Studio running.**

**Solutions:**

1. **Run without AI (app still works):**

- AI chat features will be disabled
- Regular chat and features work normally

2. **Install LM Studio:**

- Download from <https://lmstudio.ai/>
- Load a model
- Set in .env:

```bash
LMS_HOST_DEVELOPMENT=http://localhost
LMS_PORT=1234
```

3. **Configure test to skip AI tests:**

```bash
CI=true npm test
```

---

## Platform-Specific Issues

### Windows

**PowerShell script execution:**

```powershell
# If you get execution policy errors
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

**Path separators:**

- Tests use `path.join()` which handles Windows paths correctly
- If you see issues, check for hardcoded `/` paths

**File handle monitoring:**

```
File handle monitoring limited on Windows
```

This is expected - Windows doesn't expose file descriptors like Unix.

### Linux/macOS

**Permission issues:**

```bash
# Make sure test files are executable
chmod +x tests/*.test.js

# Fix npm permissions
sudo chown -R $(whoami) ~/.npm
```

**Node version:**

```bash
# Use nvm for easy version management
nvm install 18
nvm use 18
nvm alias default 18
```

---

## Quick Diagnostic Checklist

Before asking for help, try these steps:

✅ **Basic checks:**

```bash
# 1. Verify Node version
node --version  # Should be >= 18

# 2. Check dependencies
npm list --depth=0

# 3. Run environment test only
npm run test:env

# 4. Check for port conflicts
netstat -an | findstr :6969  # Windows
lsof -i :6969                # Linux/macOS

# 5. Try CI mode
npm run test:ci
```

✅ **Clean reinstall:**

```bash
npm run clean
npm install
npm test
```

✅ **Check logs:**

```bash
# Run server manually to see errors
node server.js

# Check test output
npm test > test-output.log 2>&1
```

---

## Getting Help

If you've tried the above solutions and still have issues:

1. **Check existing issues:** <https://github.com/HarleyVader/js-bambisleep-chat/issues>

2. **Create a new issue with:**
   - Test output (from `tests/reports/latest-summary.txt`)
   - Node version: `node --version`
   - OS: Windows/Linux/macOS
   - Steps you've already tried

3. **Include test logs:**

```bash
npm test 2>&1 | tee test-debug.log
```

---

## Test Report Analysis

### Understanding test output:

```
✅ ENVIRONMENT: PASS (20✅ 0❌ 0⚠️)
   All environment requirements met

❌ STABILITY: FAIL (9✅ 3❌ 1⚠️)
   Some stability issues - review recommended

⚠️ RESOURCE: PASS (8✅ 0❌ 2⚠️)
   Passes but has warnings - monitoring recommended
```

**Priority levels:**

- ❌ **Failed environment tests:** Critical - fix before deployment
- ❌ **Failed stability tests:** Important - app may crash under load
- ❌ **Failed resource tests:** Warning - may have performance issues
- ⚠️ **Warnings:** Review recommended but not blocking

### View detailed reports:

```bash
# Open HTML report in browser
npm run test:report

# View text summary
cat tests/reports/latest-summary.txt

# List all reports
npm run test:report -- --list
```

---

## Contributing Test Improvements

Found a bug in the tests? Want to improve coverage?

1. Fork the repository
2. Create a feature branch: `git checkout -b test/improvement`
3. Make your changes in `tests/` directory
4. Run tests: `npm test`
5. Submit a pull request

All test improvements welcome! 🎉
