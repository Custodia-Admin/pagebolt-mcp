# PageBolt MCP Server — Directory Submission Tracker

**Status**: Pre-submission (package + repo need to be published first)  
**Last updated**: February 2026

---

## Prerequisites Checklist

Complete these IN ORDER before any directory submissions:

- [ ] **1. Create public GitHub repo**: `github.com/Custodia-Admin/pagebolt-mcp`
  - Push all files from `/home/sentinel-pro-max/dev/pagebolt-mcp/`
  - Add topics: `mcp-server`, `model-context-protocol`, `screenshot`, `pdf`, `og-image`, `ai-tools`, `claude`, `cursor`
  - Commands:
    ```bash
    cd /home/sentinel-pro-max/dev/pagebolt-mcp
    git init
    git add .
    git commit -m "Initial release: PageBolt MCP Server v1.0.0"
    # Create repo on GitHub first (github.com/Custodia-Admin/pagebolt-mcp), then:
    git remote add origin git@github.com:Custodia-Admin/pagebolt-mcp.git
    git branch -M main
    git push -u origin main
    ```

- [ ] **2. Publish to npm**: `npm publish`
  - Verify you're logged in: `npm whoami`
  - If not: `npm login`
  - Publish: `cd /home/sentinel-pro-max/dev/pagebolt-mcp && npm publish`
  - Verify: `npm info pagebolt-mcp`

- [ ] **3. Publish to Official MCP Registry**:
  - Install: `npm install -g @anthropic-ai/mcp-publisher` (or use npx)
  - Auth: `npx @anthropic-ai/mcp-publisher login` (GitHub auth)
  - Publish: `npx @anthropic-ai/mcp-publisher publish`
  - This is the source of truth — many directories pull from it automatically

---

## Standardized Copy (Reuse Across All Submissions)

### Server Name
```
PageBolt
```

### Short Description (under 80 chars)
```
Take screenshots, generate PDFs, and create OG images from your AI assistant.
```

### Medium Description (under 160 chars)
```
MCP server for PageBolt — capture screenshots, generate PDFs, create OG/social card images, and run browser automation sequences from Claude, Cursor, or Windsurf.
```

### Long Description (for directories that allow it)
```
PageBolt MCP Server connects your AI coding assistant to PageBolt's web capture API. Take pixel-perfect screenshots of any URL with 30+ parameters (device emulation, dark mode, ad blocking, geolocation), generate PDFs (invoices, reports, contracts), create Open Graph social card images from templates or custom HTML, and run multi-step browser automation sequences — all from natural language prompts in Claude Desktop, Cursor, Windsurf, or any MCP-compatible client.

Features:
- 6 tools: take_screenshot, generate_pdf, create_og_image, run_sequence, list_devices, check_usage
- 25+ device presets (iPhone SE to Galaxy S24 Ultra, iPad Pro, MacBook, Desktop 4K)
- Automatic ad blocking, cookie banner removal, chat widget suppression
- Inline image results — screenshots appear directly in your chat
- Free tier: 100 requests/month, no credit card required
```

### Tagline
```
Capture the web. From code or AI.
```

### Category
```
Developer Tools / Web Services / Browser Automation
```

### Tags/Keywords
```
screenshot, pdf, og-image, web-capture, browser-automation, developer-tools, api
```

### Website URL
```
https://pagebolt.dev
```

### GitHub URL
```
https://github.com/Custodia-Admin/pagebolt-mcp
```

### npm URL
```
https://www.npmjs.com/package/pagebolt-mcp
```

### Installation Command
```
npx -y pagebolt-mcp
```

### MCP Config JSON (for directories that show config)
```json
{
  "mcpServers": {
    "pagebolt": {
      "command": "npx",
      "args": ["-y", "pagebolt-mcp"],
      "env": {
        "PAGEBOLT_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### Tools List (for directories that list tools)
```
1. take_screenshot — Capture screenshots of URLs, HTML, or Markdown with 30+ parameters
2. generate_pdf — Generate PDFs from URLs or HTML (A4, Letter, Legal, custom margins)
3. create_og_image — Create Open Graph / social card images from templates or custom HTML
4. run_sequence — Multi-step browser automation: navigate, click, fill, screenshot
5. list_devices — List 25+ device presets for viewport emulation
6. check_usage — Check current API usage and plan limits
```

### Features (3 bullets for forms that limit)
```
1. Screenshot, PDF & OG image generation from natural language prompts
2. 25+ device presets with automatic ad/banner/chat/tracker blocking
3. Multi-step browser automation sequences in a single session
```

---

## PHASE 1: Foundation (Do First)

### 1. GitHub Topics
- **URL**: https://github.com/Custodia-Admin/pagebolt-mcp (after creating repo)
- **Action**: Add topics via repo Settings > Topics
- **Topics to add**: `mcp-server`, `model-context-protocol`, `screenshot`, `pdf`, `og-image`, `ai-tools`, `claude`, `cursor`, `windsurf`, `developer-tools`
- **Status**: [ ] Not started

### 2. npm Registry
- **URL**: https://www.npmjs.com/package/pagebolt-mcp (after publishing)
- **Action**: `npm publish` from the pagebolt-mcp directory
- **Status**: [ ] Not started

### 3. Official MCP Registry
- **URL**: https://registry.modelcontextprotocol.io/
- **How**: Use `mcp-publisher` CLI tool after npm publish
- **Docs**: https://modelcontextprotocol.io/registry/quickstart
- **Priority**: CRITICAL — many directories auto-index from this
- **Status**: [ ] Not started

### 4. Anthropic Connectors Directory
- **URL**: https://claude.com/connectors
- **How**: Fill out Google Form: https://docs.google.com/forms/d/e/1FAIpQLSeafJF2NDI7oYx1r8o0ycivCSVLNq92Mpc1FPxMKSw1CzDkqA/viewform
- **Requirements**: Safety annotations on tools, OAuth if auth needed, production deployment, docs, support channel, test account
- **Guide**: https://support.claude.com/en/articles/12922832-local-mcp-server-submission-guide
- **Use**: Long description + MCP config from above
- **Priority**: CRITICAL — exposes to all Claude users
- **Status**: [ ] Not started

---

## PHASE 2: Major Directories (Highest Traffic)

### 5. mcp.so
- **Submit URL**: https://mcp.so/submit
- **Type**: Web form
- **Fields**: Type (MCP Server), Name, URL, Server Config
- **Fill with**:
  - Type: MCP Server
  - Name: PageBolt
  - URL: https://github.com/Custodia-Admin/pagebolt-mcp
  - Server Config: (paste MCP config JSON from above)
- **Status**: [ ] Not started

### 6. Smithery.ai
- **Submit URL**: https://smithery.ai/new
- **Type**: Account required, then publish via platform
- **Docs**: https://smithery.ai/docs/build/publish
- **Steps**:
  1. Sign up at smithery.ai
  2. Get API key
  3. Publish server (it gets qualified name like `@pagebolt/screenshot-server`)
- **Status**: [ ] Not started

### 7. Cursor.directory
- **Submit URL**: https://cursor.directory/mcp/new
- **Type**: Web form — "Add new" on MCP page
- **Fill with**: Server name, description, config
- **Use**: Short description + MCP config JSON from above
- **Priority**: HIGH — 250K+ Cursor developers
- **Status**: [ ] Not started

### 8. Glama.ai
- **Submit URL**: https://glama.ai/mcp/servers (click "Add Server")
- **Type**: GitHub URL or deployable Dockerfile
- **Fill with**: GitHub URL: https://github.com/Custodia-Admin/pagebolt-mcp
- **Status**: [ ] Not started

### 9. PulseMCP
- **Submit URL**: https://pulsemcp.com/submit
- **Type**: Web form
- **Fill with**: Server details from standardized copy above
- **Note**: Also auto-indexes from Official MCP Registry
- **Status**: [ ] Not started

### 10. Agentic.so
- **Submit URL**: https://agentic.so/
- **Type**: CLI-based (npm package: `@agentic/cli`)
- **Steps**:
  1. `npm install -g @agentic/cli`
  2. `agentic login`
  3. Deploy MCP server to public HTTPS with Streamable HTTP transport
  4. Publish via CLI
- **Docs**: https://docs.agentic.so/publishing
- **Note**: This is an actual marketplace — can monetize
- **Status**: [ ] Not started

---

## PHASE 3: Broad Coverage (Batch Submit)

### 11. MCPMarket.com
- **Submit URL**: https://mcpmarket.com/submit
- **Type**: GitHub URL submission
- **Fill with**: https://github.com/Custodia-Admin/pagebolt-mcp
- **Status**: [ ] Not started

### 12. mcpservers.org
- **Submit URL**: https://mcpservers.org/submit
- **Type**: Web form — name, description, GitHub/docs link, category, email
- **Fill with**:
  - Name: PageBolt
  - Description: (medium description from above)
  - GitHub: https://github.com/Custodia-Admin/pagebolt-mcp
  - Category: Developer Tools
  - Email: hello@pagebolt.dev
- **Optional**: $39 premium submission for faster review + official badge
- **Status**: [ ] Not started

### 13. MCPAnvil.com
- **Submit URL**: https://mcpanvil.com/ (check for submit form)
- **Type**: May auto-discover from GitHub
- **Fill with**: Standardized copy
- **Status**: [ ] Not started

### 14. MCP Repository (mcprepository.com)
- **Submit URL**: https://mcprepository.com/submit
- **Type**: GitHub URL
- **Fill with**: https://github.com/Custodia-Admin/pagebolt-mcp
- **Status**: [ ] Not started

### 15. MCP Forge (mcpforge.org)
- **Submit URL**: https://www.mcpforge.org/directory
- **Type**: Check site for form
- **Fill with**: Standardized copy
- **Status**: [ ] Not started

### 16. MCP Hunt (mcp-hunt.com)
- **Submit URL**: https://mcp-hunt.com/mcp-server-directory
- **Type**: May auto-index from GitHub
- **Note**: Focuses on security analysis — our clean dependencies help
- **Status**: [ ] Not started

### 17. MCP Central (mcpcentral.io)
- **Submit URL**: https://mcpcentral.io/servers ("My Servers" section)
- **Type**: Account-based submission
- **Fill with**: Standardized copy
- **Status**: [ ] Not started

### 18. MCPServe.com
- **Submit URL**: https://mcpserve.com/submit
- **Type**: Web form — name, description, logo, category, features, URLs
- **Fill with**:
  - Name: PageBolt
  - Description: (medium description)
  - Category: Web Services / Developer Tools
  - Features (up to 3): (use the 3 features bullets from above)
  - GitHub: https://github.com/Custodia-Admin/pagebolt-mcp
  - Website: https://pagebolt.dev
- **Status**: [ ] Not started

### 19. MCP Server Spot (mcpserverspot.com)
- **Submit URL**: https://www.mcpserverspot.com/submit
- **Type**: Web form — name, description, category, features, status, icon
- **Fill with**:
  - Name: PageBolt
  - Description: (medium description)
  - Category: Developer Tools
  - Features: Tools, Resources
  - Status: Community
  - Icon: (use pagebolt.dev favicon or logo)
- **Status**: [ ] Not started

### 20. mcphub.dev
- **Submit URL**: https://mcphub.dev/submit
- **Type**: Web form — name, email, GitHub URL
- **Fill with**:
  - Name: PageBolt
  - Email: hello@pagebolt.dev
  - GitHub: https://github.com/Custodia-Admin/pagebolt-mcp
- **Status**: [ ] Not started

---

## PHASE 4: Awesome Lists (GitHub PRs)

### 21. appcypher/awesome-mcp-servers (5.1K stars)
- **URL**: https://github.com/appcypher/awesome-mcp-servers
- **How**: Fork → edit README.md → submit PR
- **Section**: Add under "Web & Search" or "Developer Tools"
- **Entry to add**:
  ```markdown
  - [PageBolt](https://github.com/Custodia-Admin/pagebolt-mcp) - Screenshot, PDF, and OG image generation API with 30+ parameters, 25+ device presets, ad blocking, and browser automation sequences.
  ```
- **PR Title**: `Add PageBolt MCP Server (screenshot, PDF, OG image API)`
- **PR Body**:
  ```
  Adds PageBolt MCP Server to the Web & Search / Developer Tools section.

  PageBolt provides 6 tools for AI assistants:
  - take_screenshot — 30+ parameters, device emulation, ad blocking
  - generate_pdf — URL/HTML to PDF with paper format options
  - create_og_image — OG/social cards from templates or custom HTML
  - run_sequence — multi-step browser automation
  - list_devices — 25+ device presets
  - check_usage — API quota monitoring

  npm: https://www.npmjs.com/package/pagebolt-mcp
  Website: https://pagebolt.dev
  ```
- **Status**: [ ] Not started

### 22. TensorBlock/awesome-mcp-servers (537 stars)
- **URL**: https://github.com/TensorBlock/awesome-mcp-servers
- **How**: Fork → edit README.md → submit PR
- **Entry**: Same as above
- **Status**: [ ] Not started

### 23. mcpserver.cc (via GitHub issue)
- **URL**: https://github.com/Horatio-Li/awesome-mcp-servers/issues/1
- **How**: Comment on the issue with server details
- **Comment**:
  ```
  **PageBolt MCP Server**
  - GitHub: https://github.com/Custodia-Admin/pagebolt-mcp
  - npm: https://www.npmjs.com/package/pagebolt-mcp
  - Website: https://pagebolt.dev
  - Description: Take screenshots, generate PDFs, and create OG images from AI coding assistants. 6 tools, 25+ device presets, ad blocking, browser automation.
  ```
- **Status**: [ ] Not started

---

## PHASE 5: Long-Tail Directories

### 24. claudemcp.org
- **URL**: https://claudemcp.org/
- **How**: Check site for submission form
- **Fill with**: Standardized copy
- **Status**: [ ] Not started

### 25. claudemcp.com
- **URL**: https://claudemcp.com/servers
- **How**: Use "Submit a Server" option
- **Fill with**: Standardized copy
- **Status**: [ ] Not started

### 26. OpenTools.com
- **URL**: https://opentools.com/registry
- **How**: Check for contribution guidelines or contact
- **Fill with**: Standardized copy
- **Status**: [ ] Not started

### 27. MCP Server Directory (mcp-server-directory.com)
- **URL**: https://www.mcp-server-directory.com/
- **How**: Email contact@mcpserverdirectory.com or use submission form
- **Email template**:
  ```
  Subject: New MCP Server Submission: PageBolt (screenshot, PDF, OG image API)

  Hi,

  I'd like to submit PageBolt MCP Server for inclusion in your directory.

  - Name: PageBolt
  - Description: Take screenshots, generate PDFs, and create OG images from AI coding assistants like Claude, Cursor, and Windsurf.
  - GitHub: https://github.com/Custodia-Admin/pagebolt-mcp
  - npm: https://www.npmjs.com/package/pagebolt-mcp
  - Website: https://pagebolt.dev
  - Category: Developer Tools / Web Services
  - Tools: take_screenshot, generate_pdf, create_og_image, run_sequence, list_devices, check_usage

  Thanks!
  ```
- **Status**: [ ] Not started

### 28. mcpserverdirectory.org
- **URL**: https://mcpserverdirectory.org/
- **How**: Check site for submission
- **Fill with**: Standardized copy
- **Status**: [ ] Not started

### 29. mcp-awesome.com
- **URL**: https://mcp-awesome.com/
- **How**: Check site for submission
- **Fill with**: Standardized copy
- **Status**: [ ] Not started

### 30. mcphubs.ai
- **URL**: https://www.mcphubs.ai/servers
- **How**: Check site for submission
- **Fill with**: Standardized copy
- **Status**: [ ] Not started

### 31. EliteAI.tools
- **URL**: https://eliteai.tools/mcp/
- **How**: GitHub-based submission
- **Fill with**: Standardized copy
- **Status**: [ ] Not started

### 32. mcpserver.cc
- **URL**: https://mcpserver.cc/
- **How**: GitHub issue at github.com/Horatio-Li/awesome-mcp-servers/issues/1
- **Fill with**: (covered in Phase 4 #23)
- **Status**: [ ] Not started

---

## Summary

| Phase | Directories | Priority | Time Estimate |
|-------|------------|----------|---------------|
| Prerequisites | GitHub repo, npm, Official Registry | CRITICAL | 30 minutes |
| Phase 1 | GitHub topics, npm, Official Registry, Anthropic | CRITICAL | 1 hour |
| Phase 2 | mcp.so, Smithery, Cursor.directory, Glama, PulseMCP, Agentic | HIGH | 1.5 hours |
| Phase 3 | MCPMarket, mcpservers.org, MCPAnvil, MCPRepo, Forge, Hunt, Central, Serve, Spot, Hub | MEDIUM | 2 hours |
| Phase 4 | Awesome lists (3 GitHub PRs) | MEDIUM-HIGH | 45 minutes |
| Phase 5 | Long-tail directories (8 sites) | LOW-MEDIUM | 1 hour |
| **Total** | **32 submissions** | | **~6.5 hours** |

---

## After Submissions

1. **Track which directories list you** — check back in 1-2 weeks
2. **Monitor referral traffic** — see which directories drive signups
3. **Update listings** when you ship new features (add tools, update descriptions)
4. **Respond to reviews/comments** on directories that allow them
5. **Resubmit to directories** that auto-refresh when you publish new npm versions
