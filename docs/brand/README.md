# The Free Code Syndicate — Brand & Visual Identity System v1.0

Official Brand & Visual Identity specifications based on `FCS_Branding_Guide_v1.0.pdf` (01 October 2026).

---

## 1. Identity Concept

- **Brand:** The Free Code Syndicate (FCS)
- **Concept:** Icarus v2 — wings, sun, ascent, and free movement.
- **Visual Proposition:**
  - **Public-first:** Readable, inspectable, and shareable rather than promotional.
  - **Technical:** Monospace typography, RFC-like labels, structured cards, and system language are legitimate identity elements, not decoration.
  - **Ascent:** The Icarus mark introduces motion, ambition, and experimentation; compositions allow elements to exceed or cross expected boundaries.
  - **Controlled Contrast:** FCS is built from a deliberately small palette. Power comes from scale, proportion, and placement.

---

## 2. Colour System

| Token | Hex | Primary Role | Preferred Pairings |
|---|---|---|---|
| **FCS Yellow** | `#FCCE37` | Primary field, highlights, calls to action, large blocks | Black |
| **Black** | `#000000` | Text, structure, dark field, borders | Yellow, Cream, White |
| **FCS Cream** | `#FFF7E4` | Light field, paper-like surfaces, secondary background | Black |
| **FCS Red** | `#D12D2D` | Accent, warnings, emphasis, selected states | White / Cream |

### Contrast & Accessibility Rules (WCAG 2.2 AA)
- Black text is the default on yellow (`#FCCE37`) and cream (`#FFF7E4`).
- White or cream text is the default on red (`#D12D2D`).
- Yellow is a **field/fill** colour, never small body text on white or cream.
- Red is a **high-salience accent/alert**, never a full competing background.
- Colour must never carry meaning alone (pair with text, icon, border, or shape).

### UI Design Tokens
- `surface.base`: `#FFF7E4` (Primary light background)
- `surface.dark`: `#000000` (Dark sections / technical panels)
- `accent.primary`: `#FCCE37` (Primary action / highlight)
- `accent.alert`: `#D12D2D` (Error / emphasis / campaign alert)
- `text.primary`: `#000000` (Body and headings on light surfaces)
- `text.inverse`: `#FFFFFF` (Text on black or red)
- `border.default`: `#000000` (Structural boundaries)
- `focus`: `#000000` (or high-contrast ring against surface)

---

## 3. Typography System

| Family | Role | Recommended Use |
|---|---|---|
| **Archivo Mono** | Primary display / UI monospace | Headings, navigation labels, metadata, cards, poster typography, buttons |
| **Latin Modern Mono** | Secondary technical / editorial monospace | Code snippets, citations, RFC labels, technical notes, data-like content, diagrams |
| **Garet Variations** | Primary Digital / Social Media font | Designer compositions, social templates, creative display |
| **Run** | Logotype font | Master wordmark typography ("the freecode syndicate") |

---

## 4. Logo Assets & Inventory

- **`assets/logoicon.svg`**: Master vector SVG of the Icarus mark (wings + sun). Use where space is constrained, in the sticky navigation, avatars, and favicons.
- **`assets/fcs-lockup.png`**: High-resolution transparent raster master lockup (Icarus wings + sun + "the freecode syndicate" wordmark).
- **`assets/logoWtype2.svg`**: Canonical stacked vector lock-up.
- **`assets/logoWtype.svg`**: Canonical horizontal vector lock-up.
- **`assets/InkScapeDesignBoard.svg`**: Master Inkscape multi-board vector source.
- **`assets/favicon-32.png`**, **`assets/favicon-192.png`**, **`assets/favicon-512.png`**: Multi-resolution favicons generated directly from `logoicon.svg`.

### Rules & Prohibitions
- **Clear space:** Reserve minimum clear area equal to the diameter of the sun circle around the mark.
- **Do not alter:** Do not stretch, redraw, add drop shadows, apply arbitrary gradients, or change logotype typography.
- **Monochrome:** One-colour versions are permitted when required for embroidery, laser etching, or monochrome printing.

---

## 5. Source Documents

- `docs/brand/FCS_Branding_Guide_v1.0.pdf`: Complete printable brand specification guide (v1.0, 01 Oct 2026).
- `docs/brand/FCS_Branding_Guide_v1.0.docx`: Editable master source document.
