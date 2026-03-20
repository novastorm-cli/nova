# Nova Architect — Examples & Recipes

## Getting Started

### First Run

```bash
# Install
npm install -g nova-architect

# Setup AI provider
nova setup
# → Choose: openrouter (cheapest) or claude-cli (free with subscription)
# → Enter API key

# Start in your project
cd my-nextjs-app
nova start
```

### Start from Scratch

```bash
mkdir my-project && cd my-project
nova start
# → Nova detects empty directory
# → Choose template: "Next.js + TypeScript"
# → Scaffolds project, installs deps, opens browser
```

---

## Common Tasks

### Add a Component

**Voice:** "Add a navigation bar with Home, About, and Contact links"

**Text (type in input bar):** `Add a navbar with logo on the left and links on the right`

Nova will:
1. Create `components/Navbar.tsx`
2. Import it in `app/layout.tsx`
3. Style with Tailwind CSS (if available)
4. Commit changes

### Edit an Element

**Quick Edit (fastest):**
1. Press Option+I
2. Click the element
3. Type: "make it bold and blue"
4. Enter → done in 2 seconds

**Rage Click:**
1. Triple-click any element
2. Inspector popup appears
3. Type instruction → Enter

### Style Changes

Lane 1 (instant, no AI):
- "Change the header color to blue"
- "Increase padding to 20px"
- "Hide the footer"
- "Make the font size 18px"

These use regex replacement — the fastest possible execution.

### Add a Page

**Voice:** "Create an about page with team section and contact form"

Nova will:
1. Create `app/about/page.tsx`
2. Add components as needed
3. Style everything
4. Commit

### Add an API Endpoint

**Text:** `Create a POST /api/contacts endpoint that saves name and email`

Nova will:
1. Check if database is configured
2. If not → ask: "Which database? PostgreSQL, SQLite, MongoDB?"
3. You answer → Nova creates the endpoint with proper ORM setup

### Multi-Element Edit

1. Press Option+K
2. Click: header, sidebar, footer (numbered 1, 2, 3)
3. Type: "Apply dark theme to all marked elements"
4. Submit → all three updated in one task

---

## Real-World Recipes

### Recipe: Dark Mode Toggle

```
Add a dark mode toggle button in the header.
When clicked, it should toggle between light and dark themes.
Save the preference in localStorage.
Use CSS variables for theming.
```

### Recipe: Authentication

```
Add a login page with email and password fields.
Add a signup page with name, email, password.
Create /api/auth/login and /api/auth/signup endpoints.
Use JWT tokens stored in httpOnly cookies.
```

Nova will ask about the database if none is configured.

### Recipe: Dashboard Layout

```
Create a dashboard layout with:
- Sidebar navigation (collapsible)
- Top header with user avatar and notifications
- Main content area with grid of stat cards
- Footer with copyright
```

### Recipe: CRUD Table

```
Create a users management page with:
- Table showing name, email, role, created date
- Search input to filter rows
- Add user button that opens a modal form
- Edit and delete buttons on each row
- Pagination with 10 items per page
```

### Recipe: Responsive Landing Page

```
Create a landing page with:
- Hero section with headline, subtitle, CTA button
- Features grid (3 columns on desktop, 1 on mobile)
- Testimonials carousel
- Pricing table (3 tiers)
- FAQ accordion
- Footer with links and newsletter signup
```

---

## Iterative Development

### Build Step by Step

```
Step 1: "Create a blog page with a list of posts"
Step 2: "Add a sidebar with categories and tags"
Step 3: "Make each post clickable, opening a detail page"
Step 4: "Add a search bar that filters posts by title"
Step 5: "Add pagination"
```

Each step builds on previous commits. If something goes wrong:
```
> undo
> (rephrase instruction)
```

### Refine Before Executing

```
You:    "Add a contact form"
Nova:   2 task(s) ready. Execute?
You:    "Also add validation and a success message"
Nova:   (re-analyzes with both requirements)
Nova:   3 task(s) ready. Execute?
You:    y
```

---

## Framework-Specific Tips

### Next.js

- Nova detects App Router vs Pages Router automatically
- Creates `page.tsx` in `app/` for new pages
- Creates `route.ts` in `app/api/` for API endpoints
- Uses `next/link` for navigation
- Respects `layout.tsx` hierarchy
- For images: uses `<img>` with picsum placeholders (not `next/image` for external URLs)

### React + Vite

- Components go to `src/components/`
- Pages go to `src/pages/` (if using react-router)
- Uses React Router for navigation
- Tailwind CSS detected and used if installed

### Vue + Nuxt

- Detects Composition API vs Options API
- Creates pages in `pages/` directory
- Uses Nuxt auto-imports

### Django / FastAPI

- Creates views and URL routes
- Detects models and serializers
- Manages migrations (Django)

### .NET

- Detects controllers and minimal API patterns
- Reads `launchSettings.json` for ports
- Understands `[HttpGet]`, `[Route]` attributes

---

## Keyboard-Only Workflow

For developers who prefer keyboard over voice:

1. **Focus input bar** — click input field (Tab doesn't work through Shadow DOM)
2. **Type command** — `add a logout button to the header`
3. **Enter** — sends immediately
4. **Wait** — tasks created and confirmed
5. **Option+I** — quick edit any element
6. **Type fix** — `make it red` → Enter
7. **Option+K** — multi-edit mode
8. **Click elements** — mark them
9. **Type instruction** — Enter
10. **`undo`** in terminal — if something went wrong

---

## Custom Agent Prompts

### Enforce Coding Standards

`.nova/agents/developer.md`:
```markdown
You are a code generator. Follow these rules strictly:

1. All components must be functional with TypeScript
2. Use named exports only (no default exports)
3. All props must have explicit TypeScript interfaces
4. Use Tailwind CSS utility classes only (no inline styles)
5. All text must use i18n keys from lib/translations.ts
6. API calls must go through lib/api.ts client
7. Error states must show ErrorBoundary component

OUTPUT FORMAT:
=== FILE: path/to/file.tsx ===
content
=== END FILE ===

=== DIFF: path/to/file.tsx ===
unified diff
=== END DIFF ===
```

### Domain-Specific Fixer

`.nova/agents/fixer.md`:
```markdown
You fix TypeScript and build errors. Rules:

1. Never add @ts-ignore or type assertions
2. Fix the actual type, don't suppress errors
3. Missing imports: check existing components before creating new ones
4. If a package is missing, add import from existing deps only

Output ONLY === FILE === blocks with fixed content.
```

---

## Monitoring & Debugging

### Activity Log

Bottom-left of overlay. Shows:
- AI reasoning ("Thinking...")
- File writes ("Writing: components/Button.tsx")
- Task progress ("Done: task-123")
- Errors ("Failed: ...")

Click title to collapse/expand. Persists across hot reloads (max 50 entries).

### Terminal Logs

The terminal shows detailed pipeline info:
```
[Nova] Brain: analyzing "add a button" at http://localhost:3000
[Nova] Brain: sending to LLM...
[Nova] Brain: response (2341 chars)
[Nova] Developer: task "Create Button component"
[Nova] Developer: sending to LLM...
[Nova] Developer: generated 2 block(s):
[Nova]   + components/Button.tsx (1247 chars, full file)
[Nova]   ~ app/page.tsx (342 chars, diff)
[Nova] Tester: validating (iteration 1/3)...
[Nova] Tester: all checks passed!
```

### /status Command

```
> /status

Stack:      Next.js + TypeScript (pnpm)
Dev:        pnpm dev (port 3000)
Clients:    1 connected
AI:         openrouter (claude-sonnet-4-6)
Tasks:      0 pending, 3 completed
Index:      342 files, 47 components, 12 endpoints
```
