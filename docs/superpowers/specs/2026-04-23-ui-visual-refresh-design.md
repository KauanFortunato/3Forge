# UI Visual Refresh — Design Spec

**Date:** 2026-04-23
**Scope:** Visual re-skin of the 3Forge editor UI to adopt the design language in `C:\Users\sayos\Downloads\3Forge`. Pure visual adaptation — zero new features, zero business-logic changes.

## 1. Principles

1. **Substitute visual, preserve behaviour.** Every component keeps its current props, state management, and side effects. Only CSS, markup scaffolding, and icon styling change.
2. **Zero invented features.** Anything in the reference that has no real counterpart in the current editor is dropped from the UI.
3. **No regressions.** All existing tests must pass (selectors may need updating where class names change, but behavioural tests remain green).
4. **One fixed appearance.** Density, accent, and separator toggles shown in the reference's "Tweaks" panel are NOT exposed. We fix values and deliver a single consistent look.

## 2. Fixed decisions (from brainstorming)

- **Accent:** Purple `#8b5cf6` (refreshed from current `#7c44de`). `--c-accent-bg: rgba(139, 92, 246, 0.18)`, `--c-accent-fg: #ffffff`.
- **Density:** Dense only (values from reference's default density — no cozy toggle).
- **Separator style:** Hairline (1px border) only — no gap alternative.
- **Runtime Fields panel location:** Stays in the right column alongside Inspector/Export (no grid restructure). Reference places it on the left; we do not follow this to avoid churn in `App.tsx` splitter/grid logic.
- **Toolbar promotions:** Add a primary **Save** button and a **Shortcuts (?)** button to the secondary toolbar. Both wire to existing actions (`Ctrl+S` / `F1`) — no new behaviour.

## 3. Design tokens (replacing current `editor.css` root vars)

```css
:root {
  /* Surfaces */
  --c-bg-0: #0e0f11;
  --c-bg-1: #141518;
  --c-bg-2: #1a1c20;
  --c-bg-3: #1f2126;
  --c-bg-4: #262930;
  --c-bg-5: #2e3139;
  --c-viewport: #2a2d33;

  /* Borders */
  --c-border: #232529;
  --c-border-soft: #1c1e22;
  --c-border-strong: #2e3036;

  /* Text */
  --c-text: #e8eaee;
  --c-text-med: #a3a7b0;
  --c-text-dim: #6b6f78;
  --c-text-faint: #4a4d54;

  /* Accent (fixed purple) */
  --c-accent: #8b5cf6;
  --c-accent-bg: rgba(139, 92, 246, 0.18);
  --c-accent-fg: #ffffff;

  /* Semantic */
  --c-select: #3b82f6;
  --c-select-soft: rgba(59, 130, 246, 0.14);
  --c-x: #e5484d;
  --c-y: #46a758;
  --c-z: #3b82f6;
  --c-warn: #f5a524;
  --c-danger: #e5484d;

  /* Typography */
  --ff-ui: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --ff-mono: "JetBrains Mono", ui-monospace, "SF Mono", Consolas, monospace;
  --fs-xs: 10px;
  --fs-sm: 11px;
  --fs-md: 12px;
  --fs-lg: 13px;
  --fs-xl: 15px;

  /* Spacing (dense) */
  --sp-1: 2px;
  --sp-2: 4px;
  --sp-3: 6px;
  --sp-4: 8px;
  --sp-5: 12px;
  --sp-6: 16px;
  --sp-7: 24px;

  /* Heights (dense) */
  --h-menubar: 28px;
  --h-toolbar: 36px;
  --h-statusbar: 22px;
  --h-panel-hd: 26px;
  --h-control: 24px;
  --h-row: 22px;

  /* Radius */
  --r-sm: 3px;
  --r-md: 4px;
  --r-lg: 6px;

  /* Shadows */
  --sh-dropdown: 0 8px 24px rgba(0,0,0,0.45), 0 2px 4px rgba(0,0,0,0.3);
  --sh-focus: 0 0 0 1px var(--c-accent);
}
```

Backward-compat aliases: during migration, the old variable names (`--bg-app`, `--accent`, `--radius-md`, etc.) may be redefined to point at the new tokens to avoid a big-bang rewrite. These aliases are removed once all selectors have been updated.

## 4. Component mapping (final)

### 4.1 Substitute (present in both, re-skin in place)

| Current component | Reference pattern | Notes |
|---|---|---|
| `LandingPage` | Landing overlay (hero + action card + recents) | Adapt 3 breakpoints to new tokens. Keep 3 actions: Continue / Open / New. Keep recents list. |
| `MenuBar` | `.menu-bar` (28px) with 4 items and right-side chips | Trim height 32→28px. Keep 4 menus (File/Edit/View/Help). Right side: small "Local session" chip + version (from `package.json`). No `⌘K`, no auto-save (no dirty-state tracking exists). |
| `SecondaryToolbar` | `.toolbar` (36px) with left tool group + right actions | Keep Select/Move/Rotate/Scale/Frame tools. Keep view-mode toggle. Keep Undo/Redo. Keep timeline toggle. **Add:** primary Save + Shortcuts (?) buttons. |
| `SceneGraphPanel` | `.sg-row` tree pattern | Re-skin rows, chevrons, badges, action buttons. Keep drag-drop, multi-select, expand/collapse. |
| `InspectorPanel` | `.sec` collapsible sections + `.row` grid | Re-skin Object / Transform / Geometry / Material / Text / Image sections. Keep "editable fields" toggles. Keep shared-properties "Mixed" display. |
| `FieldsPanel` | Runtime Fields cards | Re-skin cards; kept in right column (NOT moved). |
| `ExportPanel` | Segmented JSON/TS + code display | Re-skin segmented control. Apply syntax-highlighting classes (`.tok-k`, `.tok-s`, etc.) to code output — visual only, produced by a small tokeniser in the component. Keep copy / download / ZIP. |
| `AnimationTimeline` | `.tl` with ruler + lanes + keyframes | Re-skin ruler ticks, tracks sidebar, keyframe diamonds, playhead. Preserve all interaction (keyframe drag, ease presets, mute, multi-select). |
| `ViewportHost` | Viewport canvas | Canvas untouched. Add CSS overlays for: view-mode label (top-left), subtle floor-shadow gradient. No interactive gizmo is added. |
| `Modal`, `ShortcutDialog`, `ContextMenu`, `MenuList` | Dropdown/modal pattern w/ `--sh-dropdown` | Restyle backdrop, surfaces, type. No behavioural changes. |
| `BufferedInput` | `.text` / `.num` input | Restyle to token sizes/colors. |
| `PhoneViewerHeader`, `PhonePlaybackBar` | Not covered in reference | Restyle with same tokens for consistency (no reference mockup exists, adapt autonomously). |

### 4.2 Dropped from the reference (not implemented)

- Tweaks panel (dev controls).
- Density toggle, accent selector, separator toggle, surface toggle.
- `Select` / `Node` / `Animation` menu-bar items.
- Playback controls in the centre of the toolbar (playback stays inside `AnimationTimeline`).
- Geometry-creation button group in toolbar (Cube/Sphere/… creation lives in the outliner's Add action).
- Interactive axis-navigation gizmo (66×66 circle in viewport).
- Command palette (`⌘K`).
- Status bar GPU% / RAM fields.
- Record indicator in playback.
- Auto-save status dot on menu bar (no dirty-state tracking in core).

### 4.3 Kept beyond the reference (current UI has, reference doesn't show)

- Inspector `Text` and `Image` sections — correspond to real node types.
- `PhonePlaybackBar` and `PhoneViewerHeader` — current responsive layouts have no reference mockup.
- Multi-select "Mixed" display in Inspector.
- Editable-fields toggle per property.

### 4.4 Status bar fields

Dense 22px bar showing only real data:

- Workspace status (e.g. `● Local session` — green `--c-y` dot).
- Selection summary (e.g. `selection: <node-name>` or count for multi-select).
- Frame `frame NNN/TOTAL @ FPSfps` — only shown when timeline is visible.
- Snap value — only if snap is active.

Dropped: camera position (not tracked at UI level), GPU%, RAM.

## 5. Icons

- Keep the current `src/editor/react/components/icons.tsx` file but unify all icons to the reference style: 14×14 viewBox, `stroke="currentColor"`, `stroke-width="1.5"`, `stroke-linecap="round"`, `stroke-linejoin="round"`, no fill.
- Add only the icons required by promotions above (`Save`, `Help/?`) and any icon referenced by re-skinned components that is missing today. Do NOT bulk-import the full 87-icon reference set.

## 6. Migration strategy (order matters)

Stage 1 is a prerequisite for all others; stages 2–6 are each gated on the previous passing `npm run validate`.

1. **Tokens.** Rewrite the `:root` block in `editor.css` with the new vars. Add compatibility aliases for the old var names. No visual change yet because aliases preserve current values of new vars only where semantically equivalent; components still look similar. Primary purpose: introduce the new token surface without breaking existing selectors.
2. **Chrome.** Re-skin `MenuBar`, `SecondaryToolbar` (including Save + Shortcuts promotions), status bar. Delete old chrome CSS.
3. **Panels.** Re-skin panel chrome (`.panel`, `.panel__hd`, `.panel__bd`), then re-skin `SceneGraphPanel`, `InspectorPanel`, `FieldsPanel`, `ExportPanel`.
4. **Timeline + viewport.** Re-skin `AnimationTimeline` and viewport HUD overlays.
5. **Landing + overlays.** Re-skin `LandingPage`, `Modal`, `ContextMenu`, `ShortcutDialog`, tooltips.
6. **Cleanup.** Remove backward-compat aliases from step 1. Remove any orphaned CSS rules. Rename class selectors to reference conventions where tests don't depend on them.

After each stage: run `npm run validate`. Any test failing because of a class-name change is fixed in the same stage (selector update), not deferred.

## 7. Test strategy

- `App.test.tsx` and per-component tests rely on class selectors (`.menu-bar__dropdown`, `.scene-row`, `.animation-keyframe`, `.modal-card`, `.context-menu`, `.panel-tabs`, `.landing-page__*`, etc.). When a class is renamed during re-skin, update the corresponding test selector in the same commit. Behavioural assertions (clicks, keyboard, state) must NOT be weakened.
- No new tests are required for visual-only changes — visual QA is manual (open `npm run dev`, click through every screen / state).
- Manual QA checklist is produced as part of the implementation plan.

## 8. Out of scope

- Light theme.
- Keyboard-accessibility audit (focus rings, WCAG contrast) beyond what tokens naturally deliver.
- Internationalisation / copy changes.
- Any change to `src/editor/*.ts` (scene, state, exports, animation, clipboard, materials, fonts, workspace, etc.).
- Changes to `public/assets` (unless a new icon asset is genuinely required).
- Performance optimisations.
- New animations / motion (preserve only existing transitions; adopt reference's 120ms standard where current code already has a transition).

## 9. Risks

1. **CSS regression surface.** `editor.css` is ~3300 lines in a single file. Staged migration plus compat aliases mitigate big-bang breakage.
2. **Test churn.** ~15–20 tests use class selectors. They must be updated as class names change. A stage is only "done" when `npm run validate` passes.
3. **Phone layout.** Reference has no phone mockup. We adapt autonomously; reviewer must check the phone layout manually since no reference exists to diff against.
4. **Icon drift.** Unifying stroke to 1.5 may alter perceived weight of icons currently used at different strokes; visual QA per icon.

## 10. Acceptance criteria

- `npm run validate` passes on the final commit.
- Every screen listed in Section 4.1 renders with the new tokens and no leftover old colours / sizes.
- No dropped item from Section 4.2 appears in the UI.
- No functional regression vs the feature list enumerated by the UI audit (file open/save, undo/redo, selection, multi-select, clipboard, property clipboard, animation timeline, export JSON/TS/ZIP, editable fields, view modes, phone layout, shortcuts).
- Manual QA checklist (produced during implementation planning) has zero open items.
