# Directory website

A static HTML directory table and a separate detail page for each source are generated from sources/*.json. The directory has search and a category filter; clicking a source opens its own page with access instructions, fields, limitations and evidence. Each detail page links back to the directory and includes official/repository and correction links. Core content works without JavaScript.

## Local review

Run npm run build with Node.js 22 or newer, then open dist/index.html in a browser. Review narrow and wide screens, keyboard navigation, no-JavaScript rendering, search/category filtering, empty results, source detail links and return navigation. This setup does not require a server or dependencies.


## Live hosting

[Browse the directory](https://new-haven-civic-data-directory.vercel.app/).

The site is hosted on Vercel, connected to the repository's main branch. Pushes to main automatically rebuild the static site using vercel.json. Deployment authentication is disabled for this directory so visitors can browse it without a Vercel account. The GitHub repository remains private; repository links and issue forms still require repository access.

## Optional GitHub Pages alternative

1. Merge the reviewed draft.
2. In repository Settings → Pages, select GitHub Actions as the source.
3. Confirm that your GitHub account supports Pages for this private repository, or explicitly choose public visibility if appropriate.
4. Run the manual Deploy directory workflow on main.
5. Inspect the deployed site and links.

The Pages workflow is manual and is not the current hosting path. GitHub CI checks builds; Vercel handles the live deployment. Repository links and issue forms require repository access, and submitting issues requires a GitHub account.

The repository's visibility has not been changed.
