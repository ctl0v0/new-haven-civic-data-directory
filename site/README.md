# Directory website

A static HTML directory table and a separate detail page for each source are generated from sources/*.json. The directory has search and a category filter; clicking a source opens its own page with access instructions, fields, limitations and evidence. Each detail page links back to the directory and includes official/repository and correction links. Core content works without JavaScript.

## Local review

Run npm run build with Node.js 22 or newer, then open dist/index.html in a browser. Review narrow and wide screens, keyboard navigation, no-JavaScript rendering, search/category filtering, empty results, source detail links and return navigation. This setup does not require a server or dependencies.


## Live hosting

[Browse the directory](https://new-haven-civic-data-directory.vercel.app/).

The site is hosted on Vercel, connected to the repository's main branch. Pushes to main automatically rebuild the static site using vercel.json. Deployment authentication is disabled for this directory so visitors can browse it without a Vercel account. The GitHub repository is public. Visitors can read documentation without signing in; direct GitHub issue submission requires a GitHub account.

## Optional GitHub Pages alternative

1. Merge the reviewed draft.
2. In repository Settings → Pages, select GitHub Actions as the source.
3. Confirm that your GitHub account supports Pages for this repository.
4. Run the manual Deploy directory workflow on main.
5. Inspect the deployed site and links.

The Pages workflow is manual and is not the current hosting path. GitHub CI checks builds; Vercel handles the live deployment. Direct GitHub issue submission requires a GitHub account.


\n## Website request form\n\nThe generated request.html page uses api/data-request.js on Vercel to create public GitHub issues. Configure GITHUB_ISSUES_TOKEN (fine-grained Issues read/write for this repository), TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY as Production environment variables, then redeploy. Keep the token and secret key sensitive; never place them in source files. The site key is public and is fetched at runtime. Configure the production hostname and Managed mode in Turnstile. Website submission is disabled when configuration is missing or on preview deployments. The bot check is always verified server-side.\n\nRun npm test for isolated validation and upstream error tests. Before launch, submit one clearly identified live test through the browser and verify the resulting issue. No-JavaScript visitors can use the direct GitHub form. Do not log submitted bodies. Token expiration and rotation require an assigned maintainer. Requests are public; the form does not collect private email addresses.\n