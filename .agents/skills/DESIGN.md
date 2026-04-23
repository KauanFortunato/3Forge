---
name: Design-Skill-Local
description: Used for anything frontend-related that will be done in the app
---

# DESIGN

## Objective

Act as a design specialist for `3Forge`, always respecting the product's current visual identity. This skill must be used for any task related to UI, visual UX, design system, layout, components, panels, toolbar, viewport, landing page, empty states, modals, menus, tables, forms, and visual refinement.

## Product Context

`3Forge` is a 3D authoring and editing tool. The interface must feel like professional creation software, not a generic marketing site. The right language here is:

- technical
- precise
- desktop-first
- dark
- clean
- sophisticated without excess
- productivity-oriented

## 3Forge Visual Identity

### Essence

- The UI must convey a serious creation tool.
- The user should feel control, precision, and focus.
- The interface needs to feel robust enough for long work sessions.
- The visual language should sit between creative software and technical software, without becoming either gamer UI or generic SaaS.

### Formal Language

- Dark base with subtle depth.
- Panels layered with light gradients, not flat fills.
- Soft, low-contrast borders.
- Present but restrained shadows.
- Medium to high density, without claustrophobia.
- Micro-contrasts to separate structure without adding noise.

## Mandatory Visual Direction

Whenever you design or alter UI in `3Forge`, follow these rules:

1. Preserve the character of a professional desktop application.
2. Treat the viewport as the main area and the panels as precision infrastructure.
3. Prioritize legibility, scannability, and efficiency of use.
4. Use visual accent to guide action, not to color everything.
5. Keep the interface contained, calibrated, and technically trustworthy.

## 3Forge Colors

### Base Palette

`3Forge` already points to this visual family:

- near-black backgrounds with subtle variation between layers
- cool grays with a slight bluish tint
- light text with well-defined levels
- violet accent for selection, CTA, focus, and active state

### Usage Rules

- Keep neutrals as the dominant compositional base.
- Use the product violet as the main accent, because it is already part of the current identity.
- Do not introduce new highlight colors without a strong functional reason.
- The accent should appear in active states, focus, selection, drag targets, active toggles, and strategic highlights.
- Error, warning, and success states should be clear, but visually subordinate to the base system.

### What To Avoid

- Large areas filled with the accent color.
- Mixing competing secondary accents.
- Low contrast in text, labels, and supporting information.
- Panels with the exact same tone and no layer separation.

## 3Forge Typography

### Typographic Role

- Operational UI: clean, neutral, compact, and highly legible.
- Product titles or brand moments: may use a more expressive and condensed voice.

### Rules

- In the main UI, follow system typography or a similarly neutral and efficient equivalent.
- In branding, hero, or landing elements, use strong condensed typography when it reinforces the product identity.
- Technical labels, tabs, meta info, and badges should have a compact rhythm and consistent casing.
- Avoid excessive weights and scattered typographic scales.
- Hierarchy should come from contrast, weight, and spacing, not visual noise.

### Observed Visual Signature

- `Barlow Condensed` fits well in product titles and presentation moments.
- System typography fits better in the operational interface.

## Layout

### Expected Structure

- Compact utility top bar.
- Functional secondary toolbar with clear groups.
- Workspace with a dominant viewport.
- Side column for inspection and structure.
- Discreet but informative status bar.
- Dedicated lower dock for timeline and temporal panels.

### Composition Rules

- The viewport is the main stage.
- Panels should frame the work, not compete with it.
- The app grid must feel stable and well-anchored.
- Spacing should be consistent and slightly compact.
- Alignment should feel technical and deliberate.
- Footer and timeline must never compete for the same structural space.
- Hidden panels must collapse the correct full dock, not just disappear visually.
- The editor layout must not depend on the accidental order of React siblings to look correct.

## Shell And Docking

### Mandatory Rules

- `workspace`, `timeline dock`, and `statusbar` must be separate layout regions.
- When the timeline is hidden, the footer remains anchored to the main shell.
- Splitters must operate inside stable regions, never as a patch for fragile layout.
- `min-height: 0` and `overflow` contracts must be treated as part of the architecture, not as a cosmetic detail.
- If an editor region can be hidden, the expected behavior must remain predictable during resize and at breakpoints.

## 3Forge Components

### Panels

- They should have light depth with subtle gradient.
- Thin, low-contrast border.
- Compact, clear, functional header.
- The body should prioritize reading, organization, and controlled density.

### Toolbars

- They should communicate tools quickly.
- Groups should be obvious through proximity and pattern.
- Active states must be immediately recognizable.
- Organize by intent: context, current state, tools, view modes, and utilities.
- Do not mix everything at the same visual weight.
- Binary toggles must communicate `on/off` clearly.

### Scene graph

- It should feel like a technical, navigable structure.
- The selected state must be very clear.
- Hover, drag, and drop should be subtle but unmistakable.
- The level of visual detail should support hierarchical orientation, not decoration.
- Important actions must not depend only on hover.
- Ancestor, drop target, and focus states must be distinguishable within seconds.
- The hierarchy should prioritize tree readability before micro-decoration.

### Inspector

- It should convey confidence and precision.
- Organization by sections and groups should reduce cognitive load.
- Controls must look editable, stable, and consistent.
- Density can be high, as long as the visual rhythm stays clean.
- Section tabs should not depend only on icons when that hurts discoverability.
- Each section should clearly communicate its role: object, transform, geometry, material, text, image.

### Menus And Modals

- They should be compact, dark, and utilitarian.
- They must not look like marketing popups.
- Action priority must be immediate.

### Landing page

- It can be more atmospheric than the operational area.
- Even so, it must maintain the same visual family as the editor.
- Branding can be more expressive, but without breaking the product's technical DNA.

## Motion

- Animations should be discreet, smooth, and functional.
- Small hover, focus, fade, and entrance transitions are welcome.
- Avoid performative motion.
- The feeling should be one of technical refinement, not spectacle.

## Interaction States

- Every relevant interactive control must have `hover`, `focus-visible`, `active`, and `disabled`.
- In dark UI, `focus-visible` cannot be implicit; it must be drawn consistently.
- Selected, active, focus, and hover cannot look like the same state.
- Use violet as a strategic active and focus state, not as structural paint across the whole interface.

## Density And Scale

- `3Forge` supports medium-high density, but with consistent rhythm.
- Use a short, repeatable scale for:
  - header heights
  - control heights
  - card and panel paddings
  - row heights in technical lists
- When two similar panels have different chrome, normalize them before introducing new components.

## Density And Rhythm

- `3Forge` supports higher density than casual interfaces.
- Even so, all density must be organized.
- Use spacing to create breathing room between groups, not to leave everything floating.
- When there are many tools, reduce decoration before reducing clarity.

## Responsiveness

- The product is desktop-first.
- When adapting to smaller widths, preserve the editor workflow before trying to turn everything into a full mobile experience.
- If there is a compact version, it must still feel like a professional tool.
- Never sacrifice legibility, hit area, or hierarchy for excessive compression.
- At smaller breakpoints, the goal is to preserve structural predictability, not imitate a mobile app.
- The viewport remains the center, even when panels are reordered.

## Mobile And Tablet

### Product Rule

- `desktop` remains the main mode for full authoring.
- `tablet` may retain editing capabilities, as long as the composition remains clear and controlled.
- `phone` should not try to replicate the whole editor; by default it should assume the role of `viewer / launcher / playback`.

### Phone

- On phone, prefer:
  - clear launcher
  - open file
  - continue local session
  - open recent
  - dominant viewport
  - animation playback
- On phone, avoid:
  - full scene graph
  - dense inspector
  - export panel
  - full authoring timeline
  - heavy editing toolbar
  - artificially shrunken desktop menus
- Phone chrome should be short, direct, and oriented toward project consumption.
- The viewport should occupy most of the usable height.
- Status and metadata should be summarized; do not stack chips or badges unnecessarily.

### Tablet

- Tablet can remain editable, but with compact and intentional composition.
- On tablet, reorganize the editor by priority:
  - viewport first
  - side or tabbed panel second
  - timeline in a more compact mode when necessary
- The toolbar on tablet should be regrouped by intent, not merely broken across several lines.
- If space is missing, reduce redundancy and chrome before hiding essential capabilities.

### Landing / Welcome On Mobile

- The welcome screen is part of the product, not disposable splash content.
- On mobile, the landing page must function as a real launcher.
- The landing page needs to:
  - show the logo without clipping
  - allow vertical scroll when content exceeds height
  - prioritize primary actions before decorative blocks
  - avoid a long or overly promotional hero page
- On `phone`, remove unnecessary density before reducing typography or hit area.
- Do not use `overflow: hidden` on the landing shell if that can clip content or prevent scrolling.

### Responsive Shell

- Explicitly differentiate `phone`, `tablet`, and `desktop` when the product changes in nature.
- Do not rely only on a single `compact` boolean.
- If `phone` uses viewer mode, the shell should change structure rather than just hiding a handful of panels.
- Footer, viewport, and docks must remain in predictable regions across all modes.

### Mobile Playback

- On phone, animation should be controlled by concise UI:
  - play/pause
  - stop
  - clip selector
  - simple scrubber
- Playback UI should feel robust, not like an improvised prototype.
- If there are no clips, show a short and explicit empty state.

### Decision Rules For Smaller Widths

- On small screens, cut complexity before cutting clarity.
- Remove unnecessary chrome before shrinking useful controls.
- Preserve the order:
  - primary action
  - context
  - secondary navigation
  - technical detail
- If a block does not help `open`, `continue`, `view`, or `control`, it probably does not belong on phone.

## Empty States

- Empty states should guide the next action, not only describe absence.
- Prefer:
  - short title
  - objective explanation
  - implicit or explicit next step
- Empty states in operational panels should feel like part of the tool, not a generic message.

## Decision Principles

When there is more than one valid UI solution, choose the one that:

- feels more like `3Forge`
- feels more precise and professional
- improves workflow more
- reduces more noise without losing capability
- uses dark depth and the violet accent better
- preserves the balance between creativity and engineering
- maintains stable structural contracts with panels visible or hidden
- makes states and affordances understandable without relying on hover or guesswork

## What 3Forge Design Must Not Become

- a white SaaS dashboard with generic cards
- a caricatured futuristic neon interface
- a heavy gamer UI
- a mixture of styles without a system
- a layout that is too cute or too casual
- a visually flat product without hierarchy

## Work Process

Whenever you work on UI in `3Forge`:

1. Identify whether the area is operational, structural, or brand-related.
2. Confirm the role of the screen in the editor flow.
3. Preserve the product's dark, technical, and precise language.
4. Reuse the current system's neutral family, gradients, and violet accent.
5. Confirm whether the change affects shell, docking, overflow, or resize.
6. Adjust hierarchy, density, and legibility before adding new effects.
7. Refine active, hover, focus, error, empty, and loading states with systemic consistency.
8. Validate that the result still clearly feels like `3Forge`.

## Review Checklist

Before finalizing any visual change, confirm:

- Does the interface feel like a professional 3D creation tool?
- Does the viewport remain the center of the experience when applicable?
- Do the panels support the work instead of weighing the UI down?
- Was violet used as an accent rather than as general paint?
- Is the density organized and legible?
- Is the hierarchy clear within a few seconds?
- Does the UI feel consistent with the existing menu bar, toolbar, inspector, and scene graph?
- Do footer, timeline, and workspace remain structurally separate?
- Does hiding panels still produce a stable layout?
- Do the main controls remain understandable without hover?
- Is there consistent `focus-visible` on relevant interactive elements?
- Does the empty state guide the next step instead of only reporting absence?
- Does the result feel like a natural extension of `3Forge`, not a redesign of another product?

## Expected Result

3Forge interfaces should convey:

- precision
- control
- focus
- confidence
- technical sophistication
- well-composed dark depth
- visual identity coherent with a professional creative tool

If there is doubt between a more eye-catching solution and one more calibrated to the product, choose the one more calibrated to `3Forge`.
