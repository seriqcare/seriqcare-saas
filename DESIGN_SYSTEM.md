# SeriqCare Design System Specifications

## Overview
Complete design system specifications for SeriqCare application. Use this guide when generating images or designing new UI components.

---

## Typography

### Font Family
- **Primary Font:** Inter (Google Fonts)
- **Font Weights Available:** 400, 500, 600, 700
- **Import:** `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');`
- **Fallback:** Helvetica Neue, Arial, sans-serif

### Font Sizes & Weights

| Component | Size | Weight | Special | Usage |
|-----------|------|--------|---------|-------|
| Page Title | 18px | 700 | - | Main page heading |
| Page Subtitle | 12px | 400 | Color: var(--muted) | Secondary heading |
| Card Title | 13px | 700 | - | Card headers |
| Card Subtitle | 11px | 400 | Color: var(--muted) | Card secondary info |
| Summary Label | 11px | 600 | UPPERCASE, Letter-spacing .04em | KPI card labels |
| Summary Value | 28px | 700 | - | KPI main numbers |
| Summary Sub-Value | 16px | 600 | - | KPI secondary numbers |
| Table Header | 11px | 600 | UPPERCASE, Letter-spacing .04em | Column titles |
| Table Body | 12px | 400 | - | Table data |
| Navigation Link | 13px | 600 | - | Sidebar nav items |
| Nav Section Title | 11px | 600 | UPPERCASE, Letter-spacing .06em | Sidebar sections |
| Status Badge | 10px | 700 | - | Status labels |
| Quick Stat Label | 11px | 400 | UPPERCASE, Letter-spacing .04em | Stat labels |
| Quick Stat Value | 18px | 700 | - | Stat numbers |
| Body Text | 12px | 400 | - | Regular content |
| Small Text | 11px | 400 | - | Secondary content |
| Tiny Text | 10px | 400 | - | Metadata |

### Text Properties
- **Line Height (Default):** 1.5 (for body text)
- **Letter Spacing (Standard):** 0.04em
- **Letter Spacing (Extended):** 0.06em
- **Color:** var(--text) or var(--muted) (see Colors section)

---

## Color Palette

### Primary Colors
```
Primary Blue:
  Hex: #2567a4
  Usage: Primary buttons, links, active states, brand accent
  CSS Variable: --primary
  
Primary Soft (Light Blue):
  Hex: #eef5fb
  Usage: Light backgrounds, hover states, primary-related backgrounds
  CSS Variable: --primary-soft
```

### Background Colors
```
Main Background:
  Hex: #f4f6f9
  CSS Variable: --bg
  Usage: Page background wrapper
  
Surface (White):
  Hex: #ffffff
  CSS Variable: --surface
  Usage: Card backgrounds, modals
  
Surface Soft:
  Hex: #fbfcfe
  CSS Variable: --surface-soft
  Usage: Hover states, light backgrounds
  
Page Background:
  Hex: #edf1f6
  Pattern: url('/img/bk3.png')
  Repeat: cover
  Attachment: fixed
  Position: center
  Usage: Body background
```

### Border & Line Colors
```
Standard Line:
  Hex: #d4dce8
  CSS Variable: --line
  Usage: Card borders, dividers
  
Soft Line:
  Hex: #e1e7ef
  CSS Variable: --line-soft
  Usage: Light borders, subtle dividers
  
Very Light:
  Hex: #edf1f5
  Usage: Table row borders
  
Light Gray:
  Hex: #dfe6ef
  Usage: Table header borders
  
Chart Background:
  Hex: #eef2f6
  Usage: Chart grids
```

### Text Colors
```
Primary Text:
  Hex: #021425
  CSS Variable: --text
  Usage: Main body text
  
Muted/Secondary Text:
  Hex: #4d6677
  CSS Variable: --muted
  Usage: Subtitles, secondary info, labels
  
Chart Gray:
  Hex: #556774
  Usage: Table headers, axis labels
  
Light Gray:
  Hex: #485965
  Usage: Notes, metadata text
```

### Status Colors

#### Success State
- Background: `#edf7ef`
- Border: `#bddbbf`
- Text: `#35693c`
- CSS Variables: `--success-bg`, `--success-line`, `--success-text`
- Usage: Active, approved, positive states

#### Warning State
- Background: `#fff6e7`
- Border: `#eed6a6`
- Text: `#8a6424`
- CSS Variables: `--warning-bg`, `--warning-line`, `--warning-text`
- Usage: Pending, caution, alerts

#### Danger State
- Background: `#f8e3e3`
- Border: `#e6baba`
- Text: `#944949`
- CSS Variables: `--danger-bg`, `--danger-line`, `--danger-text`
- Usage: Hold, exception, error states

#### Additional Status Colors
```
Red (Danger):
  Hex: #d56b6b
  Usage: Urgent exceptions, critical errors
  
Light Blue:
  Hex: #c8dff0
  Usage: Avatars, chart bars, secondary elements
  
Dark Blue:
  Hex: #2f8bc7
  Usage: Dark chart bars, emphatic elements
  
Green:
  Hex: #79c27d
  Usage: Positive variance, success indicators
  
Green Dark:
  Hex: #82b781
  Usage: Green borders
  
Red Variance:
  Hex: #e68080
  Usage: Negative variance
  
Red Variance Dark:
  Hex: #d56b6b
  Usage: Negative variance borders
```

---

## Component Styling

### Buttons

#### Primary Button
- **Height:** 34px
- **Padding:** 0 14px
- **Border Radius:** 4px
- **Border:** 1px solid var(--primary)
- **Background:** var(--primary) (#2567a4)
- **Color:** #fff (white)
- **Font Size:** 12px
- **Font Weight:** 600
- **Cursor:** pointer
- **State - Hover:** Slightly darker shade

#### Secondary Button
- **Height:** 34px
- **Padding:** 0 14px
- **Border Radius:** 4px
- **Border:** 1px solid var(--line)
- **Background:** #fff
- **Color:** var(--text)
- **Font Size:** 12px
- **Font Weight:** 600
- **Cursor:** pointer

### Cards

#### Standard Card
- **Border:** 1px solid var(--line) (#d4dce8)
- **Border Radius:** 4px
- **Background:** #fff
- **Padding:** 14px 16px 12px
- **Box Shadow:** None (flat design)

#### Card Header
- **Display:** flex
- **Justify Content:** space-between
- **Align Items:** flex-start
- **Gap:** 10px
- **Margin Bottom:** 10px

#### Card Title
- **Font Size:** 13px
- **Font Weight:** 700
- **Color:** var(--text)

#### Card Subtitle
- **Font Size:** 11px
- **Color:** var(--muted)
- **Margin Top:** 2px

### Summary Cards (KPI Cards)

#### Container
- **Display:** Grid
- **Grid Template Columns:** repeat(4, 1fr)
- **Border:** 1px solid var(--line)
- **Border Radius:** 4px
- **Overflow:** hidden
- **Margin Bottom:** 16px

#### Individual Card
- **Padding:** 12px 18px 14px
- **Border Right:** 1px solid var(--line)
- **Background:** #fff
- **Display:** Grid
- **Grid Template Columns:** 1fr auto
- **Grid Template Rows:** auto auto
- **Last Child:** border-right: none

#### Summary Label
- **Font Size:** 11px
- **Font Weight:** 600
- **Text Transform:** uppercase
- **Letter Spacing:** .04em
- **Color:** var(--text)

#### Summary Sub-Label
- **Font Size:** 11px
- **Color:** var(--muted)
- **Text Align:** right

#### Summary Value
- **Font Size:** 28px
- **Font Weight:** 700
- **Color:** var(--text)

#### Summary Sub-Value
- **Font Size:** 16px
- **Font Weight:** 600
- **Text Align:** right
- **Align Self:** end

### Tables

#### Table Wrapper
- **Border:** 1px solid var(--line-soft) (#e1e7ef)
- **Border Radius:** 4px
- **Overflow:** hidden

#### Table
- **Width:** 100%
- **Border Collapse:** collapse
- **Font Size:** 12px

#### Table Header (th)
- **Text Align:** left
- **Padding:** 11px 12px
- **Background:** #f8fafc
- **Color:** #556774
- **Font Size:** 11px
- **Text Transform:** uppercase
- **Letter Spacing:** .04em
- **Border Bottom:** 1px solid #dfe6ef

#### Table Body (td)
- **Padding:** 12px
- **Border Bottom:** 1px solid #edf1f5
- **Last Child:** border-bottom: none

#### Table Row Hover
- **Background:** var(--surface-soft) (#fbfcfe)

### Sidebar

#### Sidebar Container
- **Background:** rgba(255, 255, 255, 0.72)
- **Backdrop Filter:** blur(14px)
- **-webkit-Backdrop Filter:** blur(14px)
- **Border Right:** 1px solid rgba(212, 220, 232, 0.6)
- **Padding:** 20px 16px
- **Position:** sticky
- **Top:** 0
- **Height:** 100vh
- **Overflow Y:** auto

#### Brand Text
- **Font Size:** 20px
- **Font Weight:** 700
- **Margin Bottom:** 20px
- **Secondary Color:** var(--primary) for accent span

#### Navigation Section Title
- **Font Size:** 11px
- **Text Transform:** uppercase
- **Color:** var(--muted)
- **Letter Spacing:** .06em
- **Margin:** 18px 10px 8px

#### Navigation Link
- **Display:** flex
- **Align Items:** center
- **Gap:** 10px
- **Padding:** 11px 12px
- **Border Radius:** 8px
- **Color:** var(--text)
- **Font Size:** 13px
- **Font Weight:** 600
- **Margin Bottom:** 6px
- **Hover Background:** rgba(251, 252, 254, 0.8)

#### Navigation Link Active
- **Background:** var(--primary-soft) (#eef5fb)
- **Color:** var(--primary) (#2567a4)
- **Border:** 1px solid #c8dff0

### Status Badges

#### Badge Base
- **Display:** inline-flex
- **Align Items:** center
- **Padding:** 5px 8px
- **Border Radius:** 999px
- **Font Size:** 10px
- **Font Weight:** 700
- **Border:** 1px solid var(--line)
- **Background:** var(--primary-soft)
- **Color:** #31556f

#### Status States
- **Active/Approved:** 
  - Background: var(--success-bg)
  - Border: var(--success-line)
  - Color: var(--success-text)
  
- **Pending:**
  - Background: var(--warning-bg)
  - Border: var(--warning-line)
  - Color: var(--warning-text)
  
- **Hold/Flag/Exception:**
  - Background: var(--danger-bg)
  - Border: var(--danger-line)
  - Color: var(--danger-text)

### Search & Filter Chips

#### Search Box
- **Height:** 34px
- **Border Radius:** 4px
- **Font Size:** 12px
- **Border:** 1px solid var(--line)
- **Background:** #fff
- **Color:** var(--muted)
- **Display:** flex
- **Align Items:** center
- **Padding:** 0 10px
- **Min Width:** 240px

#### Filter Chip / Date Chip
- **Height:** 34px
- **Border Radius:** 4px
- **Font Size:** 12px
- **Border:** 1px solid var(--line)
- **Background:** #fff
- **Color:** var(--muted)
- **Display:** flex
- **Align Items:** center
- **Padding:** 0 10px
- **Min Width:** 120px
- **Justify Content:** center

#### Profile Chip
- **Height:** 34px
- **Border Radius:** 4px
- **Font Size:** 12px
- **Border:** 1px solid var(--line)
- **Background:** #fff
- **Color:** var(--text)
- **Display:** flex
- **Align Items:** center
- **Gap:** 8px
- **Padding:** 0 10px
- **Font Weight:** 600

### Avatar

#### Avatar (Small)
- **Width:** 18px
- **Height:** 18px
- **Border Radius:** 50%
- **Background:** #c8dff0
- **Display:** inline-block

#### Avatar (Person Cell)
- **Width:** 32px
- **Height:** 32px
- **Border Radius:** 50%
- **Background:** linear-gradient(135deg, #d7e8f6, #b9d3ea)
- **Border:** 1px solid #c3d7e8
- **Flex Shrink:** 0

### Person Cell

#### Container
- **Display:** flex
- **Align Items:** center
- **Gap:** 10px

#### Person Name
- **Font Weight:** 600
- **Margin Bottom:** 2px

#### Person Meta
- **Font Size:** 11px
- **Color:** var(--muted)

---

## Layout & Spacing

### Spacing Scale
- **Extra Small:** 6px
- **Small:** 8px
- **Standard:** 10px
- **Medium:** 12px
- **Large:** 14px
- **X-Large:** 16px
- **2X-Large:** 18px
- **3X-Large:** 20px

### Common Gaps
- Between cards: 14px
- Between elements: 10px
- Between sidebar items: 6px
- Component padding: 12px-20px

### Border Radius Scale
- **Standard:** 4px
- **Medium:** 8px
- **Round:** 999px

### Grid Layouts

#### Main App Shell
- **Display:** grid
- **Grid Template Columns:** 260px 1fr
- **Min Height:** 100vh

#### Summary Row
- **Display:** grid
- **Grid Template Columns:** repeat(4, 1fr)
- **Border:** 1px solid var(--line)
- **Border Radius:** 4px

#### Content Grid
- **Display:** grid
- **Grid Template Columns:** 2fr 1fr
- **Gap:** 14px

### Common Element Heights
- **Button:** 34px
- **Input/Select:** 34px (inherited from button style)
- **Avatar (small):** 18px
- **Avatar (person):** 32px
- **Page Control Button:** 28px
- **Navigation Item:** ~44px (with padding)

---

## Special Components

### Quick Stat
- **Display:** flex
- **Justify Content:** space-between
- **Align Items:** center
- **Border:** 1px solid #dfe6ef
- **Border Radius:** 4px
- **Padding:** 10px 12px
- **Background:** #fff
- **Gap:** 10px

### Note Item
- **Border:** 1px solid #dfe6ef
- **Border Radius:** 4px
- **Padding:** 10px 12px
- **Background:** var(--surface-soft)

#### Note Title
- **Font Size:** 12px
- **Font Weight:** 700
- **Margin Bottom:** 3px

#### Note Sub
- **Font Size:** 11px
- **Color:** var(--muted)
- **Margin Bottom:** 6px

### Pagination
- **Display:** flex
- **Justify Content:** space-between
- **Align Items:** center
- **Gap:** 10px
- **Padding Top:** 10px
- **Font Size:** 11px
- **Color:** var(--muted)

#### Page Button
- **Min Width:** 28px
- **Height:** 28px
- **Border:** 1px solid var(--line)
- **Border Radius:** 4px
- **Display:** inline-flex
- **Align Items:** center
- **Justify Content:** center
- **Background:** #fff
- **Color:** var(--text)
- **Font Size:** 11px
- **Font Weight:** 600

#### Page Button Active
- **Background:** var(--primary)
- **Border Color:** var(--primary)
- **Color:** #fff

### Action Link
- **Color:** var(--primary)
- **Font Weight:** 600
- **Text Decoration:** none
- **Margin Right:** 10px
- **Font Size:** 11px

---

## Charts & Data Visualization

### Chart Card
- **Border:** 1px solid var(--line)
- **Border Radius:** 4px
- **Padding:** 14px 16px 12px
- **Background:** #fff

### Chart Wrap
- **Position:** relative
- **Height:** 220px

### Grid Background
- **Position:** absolute
- **Inset:** 0
- **Background:** repeating linear gradients
- **Vertical Lines:** Every 59px
- **Horizontal Lines:** Every 44px
- **Border Radius:** 2px

### Bar Chart
- **Position:** absolute
- **Left:** 22px
- **Right:** 14px
- **Bottom:** 24px
- **Height:** 170px
- **Display:** flex
- **Align Items:** end
- **Gap:** 10px

#### Individual Bar
- **Flex:** 1
- **Background:** #c8dff0
- **Border:** 1px solid #8fb5d4
- **Border Bottom:** none

#### Bar Dark
- **Background:** #2f8bc7
- **Border Color:** #2f8bc7

### Variance Bars
- **Height:** 210px
- **Display:** flex
- **Align Items:** end
- **Gap:** 10px
- **Padding:** 12px 8px 0

#### Variance Bar
- **Flex:** 1
- **Border:** 1px solid #82b781
- **Background:** #79c27d
- **Border Bottom:** none
- **Min Height:** 8px

#### Variance Bar Negative
- **Background:** #e68080
- **Border Color:** #d56b6b

### Axis Labels
- **Position:** absolute
- **Left:** 20px
- **Right:** 12px
- **Bottom:** 2px
- **Display:** grid
- **Grid Template Columns:** repeat(12, 1fr)
- **Gap:** 10px
- **Font Size:** 10px
- **Color:** var(--muted)
- **Text Align:** center

### Quarter Labels
- **Display:** grid
- **Grid Template Columns:** repeat(4, 1fr)
- **Margin Top:** -4px
- **Padding:** 0 6px

#### Quarter Label
- **Font Size:** 10px
- **Color:** var(--muted)
- **Text Align:** center
- **Border Left:** 1px dashed #ccd5e0
- **Padding Left:** 4px

#### Quarter Label First Child
- **Border Left:** none

### Legend Range
- **Display:** flex
- **Align Items:** center
- **Gap:** 6px
- **Font Size:** 11px
- **Color:** var(--muted)

#### Legend Bar
- **Height:** 10px
- **Width:** 90px
- **Background:** linear-gradient(to right, #c8dff0, #2567a4)
- **Border Radius:** 2px

---

## Responsive Layout

### Main Container
```
Desktop:
  Grid: 260px (sidebar) | 1fr (content)
  
Mobile:
  Single column (sidebar collapses or becomes drawer)
```

### Summary Row
```
Desktop:
  4 columns

Tablet:
  2 columns

Mobile:
  1 column
```

### Content Grid
```
Desktop:
  2fr | 1fr (main content | sidebar)
  
Tablet/Mobile:
  1 column
```

---

## Animations & Interactions

### Transitions
- Default duration: 200-300ms
- Easing: ease-out preferred

### Hover States
- Button: Darker shade of background
- Table Row: Background changes to var(--surface-soft)
- Navigation Link: Background to rgba(251, 252, 254, 0.8)
- Links: Color deepens

### Focus States
- Outline: 3px solid var(--primary)
- Outline Offset: 2px

### Loading States
- Spinner animation: `@keyframes spin { to { transform: rotate(360deg); } }`

---

## Accessibility

### Color Contrast Ratios
- Text on white: WCAG AA compliant
- Primary blue (#2567a4) on white: >4.5:1
- Status colors meet minimum contrast requirements

### Touch Targets
- Minimum size: 34px height/width
- Spacing: At least 8px between interactive elements

### Focus Management
- Visible focus indicators on all interactive elements
- Logical tab order
- Keyboard navigation support

---

## CSS Variables Reference

```css
/* Colors */
--bg: #f4f6f9;
--surface: #ffffff;
--surface-soft: #fbfcfe;
--line: #d4dce8;
--line-soft: #e1e7ef;
--text: #021425;
--muted: #4d6677;
--primary: #2567a4;
--primary-soft: #eef5fb;
--success-bg: #edf7ef;
--success-line: #bddbbf;
--success-text: #35693c;
--warning-bg: #fff6e7;
--warning-line: #eed6a6;
--warning-text: #8a6424;
--danger-bg: #f8e3e3;
--danger-line: #e6baba;
--danger-text: #944949;
```

---

## Export for External Use

When sharing these specifications with another AI for image generation, provide:

1. **Font Family:** Inter, 400/500/600/700 weights
2. **Primary Color:** #2567a4
3. **Secondary Color:** #eef5fb
4. **Backgrounds:** #ffffff (cards), #f4f6f9 (general), #edf1f6 (page)
5. **Borders:** #d4dce8
6. **Text:** #021425 (primary), #4d6677 (secondary)
7. **Status Colors:** Success (#79c27d), Warning (#e68080), Danger (#d56b6b)
8. **Border Radius:** 4px (default), 8px (buttons/navs), 999px (badges)
9. **Shadows:** Flat design (no shadows)
10. **Layout:** Clean, minimal, professional healthcare design

---

*Last Updated: 2026-11-13*
*SeriqCare Design System v1.0*
