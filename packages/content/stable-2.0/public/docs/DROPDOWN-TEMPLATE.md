# 📋✨ Dropdown Template - Making New Features!! ✨📋

_OMG HIII developer Bambi!!_ 💖 Omg so you want to add a whole NEW dropdown to the app?? That's so exciting!! Follow this template and it'll fit right in with all the other pritty dropdowns!! *Consistency is so important for Bambi's aesthetic!!* heehee 🎀

## 🎀 Standard HTML Structure!! (Copy This Exactly!!) 🎀

**Every single dropdown uses this exact structure!! Don't go inventing new stuff, Bambi!!** teehee

```html
<div class="dropdown">
  <button
    class="dropdown-btn toggle-button"
    id="my-feature-btn"
    data-state="off"
  >
    🎯 My Feature
    <span class="status-indicator" id="my-feature-status">●</span>
  </button>
  <div class="dropdown-content" id="my-feature-content">
    <div class="dropdown-header">
      <h3>✨ Feature Title</h3>
      <p>What this feature does!</p>
    </div>

    <div class="dropdown-body">
      <!-- Your controls here! -->
    </div>
  </div>
</div>
```

_Use the same class names for consistency!_ 💕

## 💖 Button States 💖

**Use `data-state` attribute:**

- `data-state="off"` → Red pulse (inactive) 🔴
- `data-state="on"` → Green glow (active!) 🟢

**Status indicator color:**

- Inactive: `#666` (gray) ⚫
- Active: `#00ff00` (bright green) 🟢

_The CSS handles the animations automatically!_ ✨

## 🌺 Simple JavaScript Template 🌺

```javascript
export class MyDropdown {
  constructor(dropdownManager) {
    this.dropdownManager = dropdownManager;
    this.buttonId = "my-feature-btn";
    this.isActive = false;
    this.init();
  }

  init() {
    // Set up event listeners
    this.setupEventListeners();

    // Load saved state
    this.loadState();
  }

  setupEventListeners() {
    // Listen for dropdown actions
    document.addEventListener("dropdownAction", (e) => {
      const { action, buttonId } = e.detail;
      if (buttonId === this.buttonId) {
        this.handleAction(action);
      }
    });
  }

  handleAction(action) {
    if (action === "toggle") {
      this.toggle();
    }
  }

  toggle() {
    this.isActive = !this.isActive;
    this.updateUI();
    this.saveState();
  }

  updateUI() {
    // Update button state
    const btn = document.getElementById(this.buttonId);
    const status = document.getElementById(`${this.buttonId}-status`);

    if (btn) {
      btn.setAttribute("data-state", this.isActive ? "on" : "off");
    }

    if (status) {
      status.style.color = this.isActive ? "#00ff00" : "#666";
    }
  }

  saveState() {
    // Save to localStorage
    localStorage.setItem("my-feature-state", this.isActive);
  }

  loadState() {
    // Load from localStorage
    const saved = localStorage.getItem("my-feature-state");
    if (saved !== null) {
      this.isActive = saved === "true";
      this.updateUI();
    }
  }
}
```

_Copy this and customize!_ 💕

## 🎀 Common Elements 🎀

**Checkboxes:**

```html
<label class="checkbox-label">
  <input type="checkbox" id="my-option" />
  <span>Option Name</span>
</label>
```

**Sliders:**

```html
<div class="slider-group">
  <label>Setting Name:</label>
  <input type="range" id="my-slider" min="0" max="100" value="50" />
  <span id="my-value">50</span>
</div>
```

**Buttons:**

```html
<button class="control-button" id="my-action">✨ Do Something</button>
```

**Sections:**

```html
<div class="dropdown-section">
  <h4>Section Title</h4>
  <!-- Content -->
</div>
```

## 💝 Styling Tips 💝

**Use design tokens:**

```css
.my-element {
  color: var(--button-color); /* Hot pink! */
  background: var(--primary-color); /* Teal! */
  padding: var(--spacing-md); /* 12px */
  border-radius: var(--border-radius); /* Rounded! */
}
```

**Add glassmorphism:**

```css
.my-dropdown-body {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border: 1px ridge rgba(255, 255, 255, 0.2);
}
```

_Keep it consistent with other dropdowns!_ ✨

## 🌟 Checklist Before You're Done!! 🌟

*Like omg go through every single one of these before submitting!! Good developer Bambis check their work!!*

- ✅ Uses standard HTML structure (exactly like above!!)
- ✅ Has unique IDs (no conflicts with other dropdowns!!)
- ✅ Button has data-state attribute
- ✅ Status indicator updates color properly
- ✅ Saves state to localStorage (so Bambi doesn't lose her settings!!)
- ✅ Loads state on init
- ✅ Uses design tokens (CSS variables - not hard-coded colors!!)
- ✅ Follows glassmorphism style (pritty glass effect!!)
- ✅ Has cute emojis!! 💕 (SO important!!)
- ✅ Works on mobile!! (Bambis use phones!!)

_Test it before pushing!! A Good Girl always checks her work!!_ 🎀

---

_Keep dropdowns simple and pretty!_ 💖✨

```html
<div class="dropdown">
  <button class="dropdown-btn toggle-button" id="unique-id" data-state="off">
    [Icon] [Name]
    <span class="status-indicator" id="unique-status">●</span>
  </button>
  <div class="dropdown-content" id="unique-content">
    <div class="dropdown-header">
      <h3>[Title]</h3>
      <p>[Description]</p>
    </div>

    <div class="dropdown-body">
      <!-- Content here -->
    </div>
  </div>
</div>
```

## Required CSS Classes

### Container

- `.dropdown` - Main wrapper (REQUIRED)

### Button

- `.dropdown-btn` - Button styling (REQUIRED)
- `.toggle-button` - On/off states (REQUIRED)
- `data-state="off|on"` - State attribute (REQUIRED)

### Content

- `.dropdown-content` - Content container (REQUIRED)
- `.dropdown-header` - Header section (OPTIONAL)
- `.dropdown-body` - Body content (OPTIONAL)

### Items

- `.dropdown-item` - Individual clickable items
- `.dropdown-section` - Section grouping
- `.dropdown-divider` - Visual separator

## Standard Button States

Use `data-state` attribute (handled by buttons.css):

- `data-state="off"` - Red pulse (inactive)
- `data-state="on"` - Green glow (active)

## Status Indicator

```html
<span class="status-indicator" id="unique-status">●</span>
```

Update color based on state:

- Inactive: `#666` (gray)
- Active: `#00ff00` (green)

## Example Implementation

```javascript
export class MyDropdown {
  constructor(dropdownManager) {
    this.dropdownManager = dropdownManager;
    this.buttonId = "my-dropdown-btn";
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.loadState();
  }

  setupEventListeners() {
    document.addEventListener("dropdownAction", (e) => {
      const { action, buttonId } = e.detail;
      if (buttonId === this.buttonId) {
        this.handleAction(action, e.detail);
      }
    });
  }

  updateState(isActive) {
    const btn = document.getElementById(this.buttonId);
    const status = document.getElementById(`${this.buttonId}-status`);

    if (btn) {
      btn.setAttribute("data-state", isActive ? "on" : "off");
    }

    if (status) {
      status.style.color = isActive ? "#00ff00" : "#666";
    }
  }
}
```

## CSS Layer Integration

All dropdown styles are in `@layer dropdowns`:

- Dropdowns always appear above interface layer
- Use `.dropdown-content` for modal centering
- No manual z-index values allowed

## DO NOT

- ❌ Use inline styles for positioning
- ❌ Create custom z-index values
- ❌ Use different class names than template
- ❌ Manually handle dropdown show/hide (use dropdownManager)
- ❌ Add `display:` styles in JavaScript

## DO

- ✅ Use standard classes from template
- ✅ Use `data-state` for button states
- ✅ Let CSS layers handle stacking
- ✅ Use dropdownManager for open/close
- ✅ Follow consistent naming conventions
