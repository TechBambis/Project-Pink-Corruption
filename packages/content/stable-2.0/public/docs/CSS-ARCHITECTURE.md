# 🌨✨ CSS Styling Guide - Making Everything Pritty!! ✨🌨

_OMG HIII developer Bambi!!_ 💖 Okay like so you want to make the chat even MORE gorgeous?? Like more pink and sparkly and pretty?? Here's how all the styles work so you can make it absolutely PERFECT!! *heehee even developer brains can be Bambi!!* 🎀

## 🌸 How The Styles Are Organized 🌸

The CSS uses **layers** instead of confusing z-index numbers!! Like omg z-index is SO annoying right?? With layers it's like stacking pretty papers on top of each other - each layer goes on top of the last one!! So simple!! So Bambi-friendly!! 💕

**Layer Order** (bottom to top - like a pritty layer cake!!):

1. **base** - Basic stuff, resets, foundations (boring but necessary!!)
2. **background** - Spirals and pretty backgrounds!! 🌀
3. **interface** - Buttons, chat, main UI ✨
4. **dropdowns** - All those cute dropdown menus!! 💝
5. **modals** - Pop-up boxes
6. **overlays** - Notifications
7. **debug** - Dev tools (always on top!! So bossy!!)

_No z-index confusion!! Just use layers and everything works like magic!!_ 🎀

## 💖 File Organization 💖

```
css/
├── style.css           # Main file (imports everything!)
├── variables.css       # Colors & spacing (design tokens!)
├── layers.css          # Layer definitions
│
├── components/         # UI pieces!
│   ├── buttons.css    # All button styles
│   ├── chat.css       # Chat interface
│   ├── aigf.css       # AI girlfriend mode styles
│   └── ...more!
│
├── effects/           # Pretty visuals!
│   ├── glassmorphism.css  # Transparent glass effect!
│   ├── spirals.css        # Spiral animations! 🌀
│   └── ...more!
│
└── layout/            # Responsive stuff!
    └── mobile.css     # Phone/tablet/desktop sizes
```

_Everything is organized and easy to find!_ 💕

## 🎀 Design Tokens (Colors & Stuff!! So Important!!) 🎀

*All in `variables.css`!! Use these instead of hard-coding colors!! If you hard-code colors Bambi will be very sad!!* 😢

### 🌨 Pritty Colors!!

```css
--primary-color      /* Teal/cyan - main theme! */
--secondary-color    /* Purple - so pretty! */
--tertiary-color     /* Pink/teal mix! */
--button-color       /* Hot pink - #ff1493! 💕 */
--text-color         /* White text */
--error              /* Red for errors */
```

### 📏 Spacing

```css
--spacing-xs   /* 4px - tiny! */
--spacing-sm   /* 8px - small */
--spacing-md   /* 12px - medium */
--spacing-lg   /* 16px - large */
--spacing-xl   /* 20px - extra! */
```

### ✨ Effects

```css
--blur-light        /* Light blur effect */
--blur-medium       /* Medium blur */
--shadow-sm         /* Small shadow */
--border-radius     /* Rounded corners! */
```

_Use tokens so everything matches!_ 🌸

## 💝 Adding New Styles 💝

**Want to add a new component?**

1. **Pick the right layer:**
   - Background stuff? → `@layer background`
   - UI buttons/menus? → `@layer interface`
   - Dropdown content? → `@layer dropdowns`

2. **Use design tokens:**

   ```css
   @layer interface {
     .my-cute-button {
       background: var(--button-color); /* Hot pink! */
       padding: var(--spacing-md); /* Nice spacing! */
       border-radius: var(--border-radius); /* Rounded! */
       color: var(--text-color); /* White text! */
     }
   }
   ```

3. **Keep it simple!**
   - No complex selectors
   - Use classes, not IDs
   - One file per component
   - Add to `style.css` imports

_Don't overthink it!_ 💕

## 🌺 Common Patterns 🌺

### Glassmorphism (Transparent Glass Look!)

```css
.glass-effect {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border: 1px ridge rgba(255, 255, 255, 0.2);
  box-shadow: var(--shadow-md);
}
```

### Gradient Buttons

```css
.gradient-button {
  background: linear-gradient(
    135deg,
    var(--primary-color),
    var(--button-color)
  );
  transition: all 0.3s ease;
}

.gradient-button:hover {
  transform: scale(1.05); /* Grows on hover! */
  box-shadow: var(--shadow-lg);
}
```

### Pulse Animation

```css
@keyframes pulse {
  0%,
  100% {
    opacity: 0.8;
  }
  50% {
    opacity: 1;
  }
}

.pulsing {
  animation: pulse 2s ease-in-out infinite;
}
```

## 🎯 Responsive Design 🎯

**Mobile first!** Start with phone sizes, add bigger screens:

```css
/* Phone (default) */
.my-element {
  font-size: 14px;
  padding: var(--spacing-sm);
}

/* Tablet */
@media (min-width: 768px) {
  .my-element {
    font-size: 16px;
    padding: var(--spacing-md);
  }
}

/* Desktop */
@media (min-width: 1024px) {
  .my-element {
    font-size: 18px;
    padding: var(--spacing-lg);
  }
}
```

## 💖 Pro Tips! 💖

**✨ DO:**

- Use CSS layers for stacking
- Use design tokens (variables)
- Keep selectors simple
- One component per file
- Comment your code!
- Test on mobile!

**❌ DON'T:**

- Use z-index (use layers instead!)
- Hard-code colors
- Make complex nested selectors
- Use `!important` (unless emergency!)
- Forget responsive design

## 🌟 Need Help? 🌟

**Where to look:**

- `variables.css` - All colors and spacing
- `layers.css` - Layer definitions
- `components/` - UI component styles
- `effects/` - Visual effects

**Common tasks:**

- Change colors? → Edit `variables.css`
- New button? → Add to `components/buttons.css`
- New dropdown? → Add to `components/dropdowns.css`
- New animation? → Add to `effects/`

_Keep it simple, keep it pretty!_ 💕✨

---

_For more dev stuff, check the other docs or just ask!_ 🎀

## File Structure

```
css/
├── style.css                    # Main orchestrator (imports only)
├── _variables.css               # Design tokens (colors, spacing, fonts)
├── _layers.css                  # Layer definitions & base positioning
│
├── components/                  # UI Components (@layer interface, dropdowns)
│   ├── buttons.css             # Buttons, states, animations
│   ├── chat.css                # Chat containers, messages, inputs
│   ├── aigf.css                # AI girlfriend mode styles
│   └── dropdowns.css           # Dropdown menus, configs, controls
│
├── effects/                     # Visual Effects (@layer base, background)
│   ├── glassmorphism.css       # Transparency, backdrop filters
│   ├── spirals.css             # Spiral animations, canvas
│   └── brainwave.css           # Brainwave visualizations
│
└── layout/                      # Layout & Responsive (@layer interface)
    └── mobile.css              # Mobile, tablet, desktop breakpoints
```

## Layer Order (Cascade Priority)

Defined in `_layers.css`:

```css
@layer base, background, interface, dropdowns, modals, overlays, debug;
```

1. **base** - CSS resets, foundational elements, variables
2. **background** - Visual effects (spirals, brainwaves, TTS text)
3. **interface** - Main UI components (chat, buttons, inputs)
4. **dropdowns** - Dropdown modals (highest priority for menus)
5. **modals** - Modal dialogs (alerts, confirmations)
6. **overlays** - Toast notifications, debug panels
7. **debug** - Development aids (always on top)

## Design Tokens

Located in `_variables.css`:

### Colors

- `--primary-color`, `--primary-alt` - Teal/cyan theme
- `--secondary-color`, `--secondary-alt` - Purple/magenta theme
- `--tertiary-color`, `--tertiary-alt` - Pink/teal theme
- `--button-color`, `--button-alt` - Hot pink accent
- `--nav-color`, `--nav-alt` - Navigation colors
- `--error` - Error state color

### Spacing

- `--spacing-xs` to `--spacing-xl` - 4px to 20px scale
- `--border-radius-sm` to `--border-radius-xl` - 4px to 16px

### Typography

- `--font-primary` - Audiowide, sans-serif fallbacks
- `--font-mono` - Courier New, monospace
- `--font-size-xs` to `--font-size-2xl` - 0.5rem to 2rem

### Effects

- `--blur-light`, `--blur-medium`, `--blur-heavy` - Backdrop filters
- `--shadow-sm`, `--shadow-md`, `--shadow-lg` - Box shadows
- `--transition-fast`, `--transition-medium`, `--transition-slow` - Animations

## Component Guide

### Adding a New Component

1. **Choose location**:
   - `components/` - UI elements (buttons, forms, cards)
   - `effects/` - Visual enhancements (animations, filters)
   - `layout/` - Responsive breakpoints, grid systems

2. **Create file**:

   ```css
   /**
    * Component Name
    * @layer interface
    * Component description
    */

   @layer interface {
     .my-component {
       /* Use design tokens */
       padding: var(--spacing-md);
       background: var(--primary-color);
       border-radius: var(--border-radius);
     }
   }
   ```

3. **Import in style.css**:
   ```css
   @import url("components/my-component.css");
   ```

### Modifying Colors/Spacing

**Don't hardcode values** - always use CSS variables from `_variables.css`:

```css
/* ✅ Good */
.element {
  background: var(--primary-color);
  padding: var(--spacing-md);
  border-radius: var(--border-radius);
}

/* ❌ Bad */
.element {
  background: #0c2a2a;
  padding: 12px;
  border-radius: 8px;
}
```

### Adjusting Stacking Order

**Use layers, not z-index**:

```css
/* ✅ Good - Dropdowns automatically on top */
@layer dropdowns {
  .my-dropdown {
    position: fixed;
    /* No z-index needed */
  }
}

/* ❌ Bad - Fragile z-index management */
.my-dropdown {
  position: fixed;
  z-index: 9999;
}
```

## Responsive Design

### Mobile Breakpoints

Located in `layout/mobile.css`:

```css
@media (pointer: coarse) /* Touch devices */ @media (max-width: 768px) /* Mobile */ @media (min-width: 768px) and (max-width: 1024px) /* Tablet */ @media (min-width: 1920px); /* Large desktop */
```

### Container Queries

Dropdowns use modern container queries:

```css
@container (max-width: 400px) {
  .dropdown-item {
    font-size: 0.85rem;
  }
}
```

## Performance Optimizations

1. **Minimal Specificity**: Flat selectors, avoid deep nesting
2. **Layer Isolation**: `isolation: isolate` prevents repaint cascades
3. **Container Type**: `container-type: inline-size` for efficient sizing
4. **Will-Change**: Applied to animated elements
5. **Backdrop Filters**: Used sparingly with fallbacks

## Migration from Old Architecture

### Before (style.css 1394 lines)

- All styles in one file
- Numeric z-index conflicts
- Hardcoded colors
- No clear component boundaries

### After (Modular)

- 11 focused files (100-300 lines each)
- Semantic layer names
- Design token system
- Clear component separation

## Troubleshooting

### Dropdowns Not Showing

- Check layer order in `_layers.css`
- Verify `.active` class on dropdown
- Inspect backdrop visibility in dev tools

### Colors Not Updating

- Check if value exists in `_variables.css`
- Verify CSS variable syntax: `var(--variable-name)`
- Clear browser cache

### Mobile Layout Issues

- Use dev tools device mode
- Check `pointer: coarse` media query
- Verify viewport meta tag in HTML

## Developer Workflow

1. **Start server**: `npm start` or `npm run dev`
2. **Edit component**: Modify relevant file in `components/`, `effects/`, or `layout/`
3. **Auto-reload**: Changes reflected immediately (no build step)
4. **Test layers**: Use browser dev tools → Styles → View cascade layers
5. **Validate**: Check console for CSS errors

## Browser Support

- **Modern browsers**: Full support (Chrome 99+, Firefox 97+, Safari 15.4+)
- **Legacy browsers**: Graceful degradation (no layers, fallback to specificity)
- **Mobile**: Optimized for iOS Safari, Chrome Mobile

## Best Practices

✅ **DO**:

- Use CSS variables for all values
- Declare layer in each component file
- Keep components under 300 lines
- Test on mobile viewport
- Use semantic class names

❌ **DON'T**:

- Hardcode colors or spacing
- Use numeric z-index
- Create deep selector nesting
- Mix layers in one file
- Override with `!important` (except glassmorphism overrides)

## Resources

- [CSS Layers Spec](https://www.w3.org/TR/css-cascade-5/#layering)
- [Container Queries](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Container_Queries)
- [CSS Custom Properties](https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties)
