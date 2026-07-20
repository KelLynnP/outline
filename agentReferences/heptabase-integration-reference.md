# Heptabase Integration Reference (Fact-Checked)

**Verified:** July 19, 2026, against Heptabase's official help center and public wiki.
**Purpose:** Portable context doc for a personal "life console" project (daily grounding, reminders like taxes/meals, goal review, reflection resurfacing). Paste this into a Claude project or conversation so it knows how to work with Heptabase.

---

## 1. The big picture

Heptabase does **not** have a traditional public REST API. Its official integration surface has three parts:

1. **MCP server** (`https://api.heptabase.com/mcp`) — the main event. Lets AI services (Claude, ChatGPT, Claude Code, Cursor, etc.) read, search, and write to your space. Released May 2026.
2. **Deeplinks** — copyable URLs to specific cards, blocks, whiteboards, and sections. No API needed; ideal for launcher/dashboard buttons.
3. **CLI** — a command-line tool (see support article "How to use Heptabase CLI"). Not covered in depth here.

For a life console, the practical split is: **deeplinks for navigation, MCP for intelligence** (searching notes, reading journals, writing reflections back).

---

## 2. Connecting the MCP server

- **Endpoint:** `https://api.heptabase.com/mcp`
- **Auth:** OAuth. When you add the connector, you're redirected to Heptabase to sign in and click Allow. Authorization is stored server-side.
- **In Claude.ai:** Settings → Connectors → add a custom connector with the URL above, then authorize.
- **In Claude Code:** `claude mcp add --transport http heptabase-mcp https://api.heptabase.com/mcp`, then run `/mcp` and select it to authenticate.
- **In Cursor or other IDEs:** add an mcpServers entry running `npx -y mcp-remote@latest https://api.heptabase.com/mcp --transport http-only`.

**Known auth gotcha (mostly macOS):** if the Heptabase *desktop app* opens during OAuth instead of a browser authorization page, the desktop app is intercepting the redirect and the flow stalls. Fix: in the Heptabase **web app**, go to Settings → Heptabase Link Opening Preference → set to "Open in browser" (or "Always ask"), then retry. Last resort: temporarily uninstall the desktop app, authorize via browser, reinstall.

---

## 3. MCP tools available (verified tool names)

You can usually just talk naturally and the AI picks tools itself, but you can name tools explicitly for precise control.

### Writing
- **`save_to_note_card`** — creates a new note card; it lands in your **Inbox** (like Web Clipper captures). Use for saving AI outputs, plans, summaries as permanent notes.
- **`append_to_journal`** — appends new blocks to **today's** journal (auto-creates it if missing; never overwrites existing content). Use for daily reflections and quick logs.

### Searching & discovery
- **`semantic_search_objects`** — finds relevant objects across your space using combined full-text (keyword) and semantic (meaning-based) search. Usually the first call.
- **`search_whiteboards`** — finds whiteboards by name/title/keywords; useful for understanding how a project or theme is organized.

### Reading
- **`get_object`** — reads the *full* content of a specific object: note cards, journals, media cards (incl. transcripts), highlights, whiteboard sections/text elements, chats. Uses a `hasMore` flag for pagination; avoid on very large PDF cards.
- **`get_whiteboard_with_objects`** — returns a whiteboard's full structure (cards, sections, mindmaps, text, relationships) with partial content of the objects on it.
- **`get_journal_range`** — retrieves **all daily journal entries between two dates (inclusive), with complete content**. Limit: roughly **3 months per call**; longer spans require multiple calls. This is the key tool for the "where have I been" / reflection-review use case.

### PDFs
- **`search_pdf_content`** — keyword search (fuzzy OR) inside a specific PDF; returns up to 80 ranked chunks with surrounding context. Requires knowing which PDF card first.
- **`get_pdf_pages`** — pulls complete content for a page range (1-indexed, inclusive). Confirm before pulling 100+ pages.

### Typical chains
1. Discover: `semantic_search_objects` → `search_whiteboards`
2. Read: `get_whiteboard_with_objects` → `get_object`
3. Journals over time: `get_journal_range` (review) / `append_to_journal` (write)
4. PDFs: `semantic_search_objects` → `search_pdf_content` → `get_pdf_pages`
5. Save back: `save_to_note_card` or `append_to_journal`

---

## 4. Deeplinks (for the launcher side)

- **Cards / blocks:** right-click a card → **Copy link**; or a block's menu → **Copy link to block**.
- **Whiteboards / sections:** whiteboard menu (top-right) or right-click a section → **Copy link**.
- **Tabs:** copy the browser URL of any open card/whiteboard tab.
- Links open in the desktop app or web app depending on your preference (**Settings → General** in the web app).
- **Limitations (as of the May 2025 article):** deeplinks are only shareable with collaborators (no public card links yet; whiteboards can be published separately), and mobile deeplink support was planned but not yet released.

---

## 5. Known constraints & caveats

- No general-purpose REST API — anything not covered by MCP tools, deeplinks, or the CLI isn't officially accessible.
- `append_to_journal` only targets **today's** journal — you can't write to arbitrary past/future dates via MCP.
- `get_journal_range` caps at ~3 months per call.
- MCP write surface is narrow by design: new inbox cards and journal appends. No editing existing cards, no moving cards onto whiteboards via MCP (whiteboard editing is on Heptabase's public roadmap under AI Agent features, so this may change).
- OAuth token lives server-side per authorized service; each AI service/account connects separately (so connecting on a personal Claude account is a fresh, independent authorization).

---

## 6. Suggested prompts for the life console workflows

- "Use `get_journal_range` for the last 30 days and tell me what themes I kept circling."
- "Use `semantic_search_objects` to find my notes on [goal], then summarize where I left off."
- "Use `append_to_journal` to log: [today's reflection]."
- "Pull my 'Goals' whiteboard with `get_whiteboard_with_objects` and check what I said my quarterly priorities were."
- "Save this plan with `save_to_note_card` so I can place it on a whiteboard later."

---

## 7. Sources

- How to use Heptabase MCP (Heptabase Help Center, updated May 28, 2026): https://support.heptabase.com/en/articles/12679581-how-to-use-heptabase-mcp
- How to use deeplinks in Heptabase (Heptabase Help Center, May 14, 2025): https://support.heptabase.com/en/articles/11176386-how-to-use-deeplinks-in-heptabase
- Heptabase CLI (not reviewed in detail): https://support.heptabase.com/en/articles/14715462-how-to-use-heptabase-cli
- Heptabase public roadmap (AI Agent whiteboard editing planned): https://wiki.heptabase.com/roadmap/
