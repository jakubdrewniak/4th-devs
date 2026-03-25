> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Introduction

> Browsers-as-a-service API for web agents, automations, and more

Kernel is a developer platform that provides Crazy Fast Browsers-as-a-Service for browser automations and web agents. Our API and MCP server allow you to instantly launch browsers in the cloud without managing infrastructure.

## Connect over CDP

If you are already familiar with browser vendors, you can immediately start using our browsers with `kernel.browsers.create()`. We return a **CDP url** that you can connect any Playwright or Puppeteer automation to.

<Info>
  Install the Kernel SDK with `npm install @onkernel/sdk` or `uv pip install kernel`
</Info>

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';
  import { chromium } from 'playwright';

  const kernel = new Kernel();

  const kernelBrowser = await kernel.browsers.create();
  const browser = await chromium.connectOverCDP(kernelBrowser.cdp_ws_url);
  ```

  ```python Python theme={null}
  from kernel import Kernel
  from playwright.async_api import async_playwright

  kernel = Kernel()

  kernel_browser = kernel.browsers.create()
  async with async_playwright() as playwright:
      browser = await playwright.chromium.connect_over_cdp(kernel_browser.cdp_ws_url)
  ```
</CodeGroup>

## Kernel app platform

If you're new to building web agents or browser automations, our platform provides a full-featured code execution platform for hosting and invoking your automations in production. Follow our [quickstart guide](/quickstart#getting-started) to get started.

You can also use Kernel without installing anything in [our playground](https://dashboard.onkernel.com/playground).

## Why Kernel?

Developers love our platform for its performance, developer experience, and all the other niceties that would otherwise be impractical to homeroll yourself:

* **Serverless browsers** - Connect your web automation to our cloud-based browsers without managing infrastructure
* **Session state** - Securely reuse auth cookies and session state via [Profiles](/browsers/profiles). Browsers can run for up to 72 hours via [timeout configuration](/browsers/termination)
* **Live view** - Support human-in-the-loop workflows
* **Replays** - Review past browser sessions as video replays
* **Full isolation** - Kernel browsers are sandboxed in individual, isolated virtual machines
* **Parallel scaling** - Run hundreds or thousands of concurrent browsers at scale
* **Simple, predictable pricing** - We only charge for active browser time
> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Quickstart

export const YouTubeVideo = ({videoId, title = "YouTube video"}) => {
  return <div style={{
    position: 'relative',
    width: '100%',
    aspectRatio: '16 / 9',
    marginBottom: '1rem'
  }}>
      <iframe width="100%" height="100%" src={`https://www.youtube.com/embed/${videoId}`} title={title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen style={{
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%'
  }} />
    </div>;
};

<Info>
  If you are already familiar with browser vendors and are looking to quickly switch to Kernel browsers, follow the instructions **[here](/browsers/create-a-browser)**.
</Info>

## Getting started

This quickstart guide will help you deploy and invoke your first browser automation on Kernel. You'll create a simple automation using Playwright, Computer Use, or a web agent framework like Browser Use.

<YouTubeVideo videoId="trMR8HM0Zgs" title="Kernel Quickstart Video" />

## Prerequisites

* `brew` for the Kernel CLI
* A [Kernel account](https://dashboard.onkernel.com/sign-up)

> **Note:** You can also deploy and invoke apps using the [Kernel MCP server](/reference/mcp-server) from AI assistants (Cursor, Goose, Claude, etc.).

## 1. Install the Kernel CLI

```bash  theme={null}
# Using brew
brew install onkernel/tap/kernel

# Using pnpm
pnpm install -g @onkernel/cli

# Using npm
npm install -g @onkernel/cli
```

Verify the installation exists:

```bash  theme={null}
which kernel
```

## 2. Create a new Kernel app

```bash  theme={null}
kernel create
```

## 3. Authenticate with Kernel

The easiest way to authenticate is using OAuth:

```bash  theme={null}
kernel login
```

This will open your browser to complete the authentication flow. Your credentials will be securely stored and automatically refreshed.

## 4. Deploy the sample app on Kernel

<CodeGroup>
  ```bash Typescript / Javascript theme={null}
  cd sample-app
  kernel deploy index.ts # --env-file .env if environment variables are needed
  ```

  ```bash Python theme={null}
  cd sample-app
  kernel deploy main.py # --env-file .env if environment variables are needed
  ```
</CodeGroup>

## 5. Invoke the app

<CodeGroup>
  ```bash Typescript / Javascript theme={null}
  # Sample app
  kernel invoke ts-basic get-page-title --payload '{"url": "https://www.google.com"}'

  # CAPTCHA Solver
  kernel invoke ts-captcha-solver test-captcha-solver

  # Stagehand
  kernel invoke ts-stagehand teamsize-task --payload '{"company": "Kernel"}'

  # Magnitude
  kernel invoke ts-magnitude mag-url-extract --payload '{"url": "https://en.wikipedia.org/wiki/Special:Random"}'

  # Anthropic Computer Use
  kernel invoke ts-anthropic-cua cua-task --payload '{"query": "Return the first url of a search result for NYC restaurant reviews Pete Wells"}'

  # OpenAI Computer Use
  kernel invoke ts-openai-cua cua-task --payload '{"task": "Go to https://news.ycombinator.com and get the top 5 articles"}'

  # Gemini Computer Use
  kernel invoke ts-gemini-cua gemini-cua-task --payload '{"startingUrl": "https://www.magnitasks.com/", "instruction": "Click the Tasks option in the left-side bar, and move the 5 items in the To Do and In Progress items to the Done section of the Kanban board"}'
  ```

  ```bash Python theme={null}
  # Sample app
  kernel invoke python-basic get-page-title --payload '{"url": "https://www.google.com"}'

  # CAPTCHA Solver
  kernel invoke python-captcha-solver test-captcha-solver

  # Browser Use
  kernel invoke python-bu bu-task --payload '{"task": "Compare the price of gpt-4o and DeepSeek-V3"}'

  # Anthropic Computer Use
  kernel invoke python-anthropic-cua cua-task --payload '{"query": "Return the first url of a search result for NYC restaurant reviews Pete Wells"}'

  # OpenAI Computer Use
  kernel invoke python-openai-cua cua-task --payload '{"task": "Go to https://news.ycombinator.com and get the top 5 articles"}'

  # OpenAGI Computer Use
  kernel invoke python-openagi-cua openagi-default-task --payload '{"instruction": "Navigate to https://agiopen.org and click the What is Computer Use? button", "record_replay": "True"}'
  ```
</CodeGroup>

## Next steps

Nice work! With Kernel, you:

1. Developed an app that uses Playwright, Computer Use, or a web agent framework like Browser Use
2. Deployed and invoked it in the cloud

You can now update your browser automation with your own logic and deploy it again. Install our [MCP server](/reference/mcp-server) to give your coding agent our `search_docs` tool.

## Sample apps reference

These are the sample apps currently available when you run `kernel create`:

| Template                   | Description                                      | Framework                  |
| -------------------------- | ------------------------------------------------ | -------------------------- |
| **sample-app**             | Implements a basic Kernel app                    | Playwright                 |
| **captcha-solver**         | Demo of Kernel's auto-CAPTCHA solving capability | Playwright                 |
| **browser-use**            | Implements Browser Use SDK                       | Browser Use                |
| **stagehand**              | Implements the Stagehand v3 SDK                  | Stagehand                  |
| **anthropic-computer-use** | Implements an Anthropic computer use agent       | Anthropic Computer Use API |
| **openai-computer-use**    | Implements an OpenAI computer use agent          | OpenAI Computer Use API    |
| **gemini-computer-use**    | Implements a Gemini computer use agent           | Gemini Computer Use API    |
| **openagi-computer-use**   | Implements an OpenAGI computer use agent         | OpenAGI Computer Use API   |
| **magnitude**              | Implements the Magnitude.run SDK                 | Magnitude.run              |
> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Create a Browser

Kernel browsers were designed to be lightweight, fast, and efficient for cloud-based browser automations at scale. They can be used as part of the Kernel [app platform](/apps/develop) or connected to from another service with the Chrome DevTools Protocol.

## 1. Create a Kernel browser

<Info>
  First, install the Kernel SDK:

  * Typescript/Javascript: `npm install @onkernel/sdk`
  * Python: `pip install kernel`
</Info>

Use our SDK to create a browser:

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';

  const kernel = new Kernel();

  const kernelBrowser = await kernel.browsers.create();
  console.log(kernelBrowser.session_id);
  ```

  ```python Python theme={null}
  from kernel import Kernel

  kernel = Kernel()

  kernel_browser = kernel.browsers.create()
  print(kernel_browser.session_id)
  ```
</CodeGroup>

## 2. Connect over CDP

Then, you can connect to the browser with any Chrome DevTools Protocol framework, such as Playwright or Puppeteer. You can also use our [Computer Controls API](/browsers/computer-controls) to control the browser's mouse and keyboard without using a CDP connection. This is useful for vision-based LLM loops like [Claude Computer Use](/integrations/computer-use/anthropic).

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import { chromium } from 'playwright';

  // Playwright
  const browser = await chromium.connectOverCDP(kernelBrowser.cdp_ws_url);

  // Or with Puppeteer
  import puppeteer from 'puppeteer';

  const browser = await puppeteer.connect({
    browserWSEndpoint: kernelBrowser.cdp_ws_url,
    defaultViewport: null, // Optional: inherit viewport from the browser
  });
  ```

  ```python Python theme={null}
  from playwright.async_api import async_playwright

  async with async_playwright() as playwright:
      browser = await playwright.chromium.connect_over_cdp(kernel_browser.cdp_ws_url)
  ```
</CodeGroup>

## 3. Tear it down

When you're finished with the browser, you can delete it:

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';

  const kernel = new Kernel();

  await kernel.browsers.deleteByID(kernelBrowser.session_id);
  ```

  ```python Python theme={null}
  from kernel import Kernel

  kernel = Kernel()
  await kernel.browsers.delete_by_id(kernel_browser.session_id)
  ```
</CodeGroup>

Browsers automatically delete after a timeout (default 60 seconds) if they don't receive a CDP or live view connection. You can [configure this timeout](/browsers/termination#automatic-deletion-via-timeout) when creating the browser.

## Full example

Once you've connected to the Kernel browser, you can do anything with it.

<Info>
  Kernel browsers launch with a default context and page. Make sure to access
  the [existing context and
  page](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)
  (`contexts()[0]` and `pages()[0]`), rather than trying to create a new one.
</Info>

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';
  import { chromium } from 'playwright';

  const kernel = new Kernel();

  const kernelBrowser = await kernel.browsers.create();
  const browser = await chromium.connectOverCDP(kernelBrowser.cdp_ws_url);

  try {
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());
    await page.goto('https://www.onkernel.com');
    const title = await page.title();
  } catch (error) {
    console.error(error);
  } finally {
    await browser.close();
    await kernel.browsers.deleteByID(kernelBrowser.session_id);
  }
  ```

  ```python Python theme={null}
  from kernel import Kernel
  from playwright.async_api import async_playwright

  kernel = Kernel()

  kernel_browser = kernel.browsers.create()

  async with async_playwright() as playwright:
      browser = await playwright.chromium.connect_over_cdp(kernel_browser.cdp_ws_url)

      try:
          context = browser.contexts[0] if browser.contexts else await browser.new_context()
          page = context.pages[0] if context.pages else await context.new_page()
          await page.goto('https://www.onkernel.com')
          title = await page.title()
      except Exception as e:
          print(e)
      finally:
          await browser.close()
          await kernel.browsers.delete_by_id(kernel_browser.session_id)
  ```
</CodeGroup>
> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Live View

Humans-in-the-loop can access the live view of Kernel browsers in real-time to resolve errors or take unscripted actions.

To access the live view, visit the `browser_live_view_url` provided when you create a Kernel browser:

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';

  const kernel = new Kernel();

  const browser = await kernel.browsers.create();
  console.log(browser.browser_live_view_url);
  ```

  ```python Python theme={null}
  from kernel import Kernel

  kernel = Kernel()

  browser = kernel.browsers.create()
  print(browser.browser_live_view_url)
  ```
</CodeGroup>

## Query parameters

The `browser_live_view_url` supports additional query parameters to customize the live view:

* `readOnly` (bool): when set to `true`, the view will be non-interactive.

Example:

```
https://api.onkernel.com/browser/live/<TOKEN>?readOnly=true
```

## Embedding in an iframe

The live view URL can be embedded in an iframe to integrate the browser view into your own application or dashboard.

```html  theme={null}
<iframe src={browser.browser_live_view_url}></iframe>
```

## Kiosk mode

Kiosk mode provides a fullscreen live view experience without browser UI elements like the address bar and tabs. You can enable kiosk mode when creating a browser by setting the `kiosk_mode` parameter to `true`.

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  const browser = await kernel.browsers.create({
      kiosk_mode: true
  });
  ```

  ```python Python theme={null}
  kernel_browser = kernel.browsers.create(
      kiosk_mode=True
  )
  ```
</CodeGroup>

## URL lifetime

`browser_live_view_url` becomes invalid once the browser is [deleted](/browsers/termination) manually or via timeout.
> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Termination & Timeouts

Kernel browsers should be terminated after you're done with them.

<Info>
  Using Playwright/Puppeteer's method `browser.close()` does not delete the browser. Use one of the methods below to delete the browser.
</Info>

## Deleting a browser via session ID

Every browser instance has a `session_id`. You can delete any browser using its session ID:

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';

  const kernel = new Kernel();

  await kernel.browsers.deleteByID('htzv5orfit78e1m2biiifpbv');
  ```

  ```python Python theme={null}
  from kernel import Kernel

  kernel = Kernel()
  kernel.browsers.delete_by_id("htzv5orfit78e1m2biiifpbv")
  ```
</CodeGroup>

## Automatic deletion via timeout

If you don't manually delete a browser, it will be automatically deleted after a configurable `timeout` (default 60 seconds). The timeout begins when the browser does not see a CDP or live view connection.

You can set a custom timeout of up to 72 hours when creating a browser:

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';

  const kernel = new Kernel();

  const browser = await kernel.browsers.create({ timeout_seconds: 300 });
  console.log(browser.session_id);
  ```

  ```python Python theme={null}
  from kernel import Kernel

  kernel = Kernel()

  browser = kernel.browsers.create(timeout_seconds=300)
  print(browser.session_id)
  ```
</CodeGroup>
> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Standby Mode

Kernel browsers enter standby mode during periods of inactivity. When a browser goes into standby mode, the browser's state remains the same but incurs zero usage costs.

Kernel browsers automatically enter standby when no CDP or Live View client is connected for `five seconds`. After it enters standby, the browser's [timeout](/browsers/termination#automatic-deletion-via-timeout) countdown begins.

<Info>
  See [here](/browsers/termination) to learn about destroying browsers.
</Info>
> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Headless Mode

Kernel browsers ship in `Headful` mode by default. In Headful mode, the launched browser has a corresponding GUI. This enables features like [live view](/browsers/live-view) and [replays](/browsers/replays).

`Headless` mode runs without a visual interface. They generally run faster and have a lighter footprint (1 GB rather than headful's 8 GB), resulting in significant cost savings. This is useful for short-lived or highly concurrent browser automations.
Some bot detectors may detect headless mode.

To launch a Kernel browser in `Headless` mode, set its config:

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';

  const kernel = new Kernel();

  const kernelBrowser = await kernel.browsers.create({
    headless: true,
  });
  ```

  ```python Python theme={null}
  from kernel import Kernel

  kernel = Kernel()

  kernel_browser = kernel.browsers.create(headless=True)
  ```
</CodeGroup>

<Info>
  [Live View](/browsers/live-view) and [Replays](/browsers/replays) are not available in headless mode.
</Info>
> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Headless Mode

Kernel browsers ship in `Headful` mode by default. In Headful mode, the launched browser has a corresponding GUI. This enables features like [live view](/browsers/live-view) and [replays](/browsers/replays).

`Headless` mode runs without a visual interface. They generally run faster and have a lighter footprint (1 GB rather than headful's 8 GB), resulting in significant cost savings. This is useful for short-lived or highly concurrent browser automations.
Some bot detectors may detect headless mode.

To launch a Kernel browser in `Headless` mode, set its config:

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';

  const kernel = new Kernel();

  const kernelBrowser = await kernel.browsers.create({
    headless: true,
  });
  ```

  ```python Python theme={null}
  from kernel import Kernel

  kernel = Kernel()

  kernel_browser = kernel.browsers.create(headless=True)
  ```
</CodeGroup>

<Info>
  [Live View](/browsers/live-view) and [Replays](/browsers/replays) are not available in headless mode.
</Info>
> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Viewports

> Configure browser viewport size and refresh rate for your automations

Kernel browsers allow you to configure the viewport size and refresh rate when creating a browser session. The viewport configuration determines the initial browser window dimensions and display refresh rate. The refresh rate can be explicitly specified or automatically determined based on the width and height if they match a supported configuration.

## Default viewport

If the `viewport` parameter is omitted when creating a browser, the default configuration is 1920x1080 at 25Hz.

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  // Uses default viewport (1920x1080@25Hz)
  const defaultViewport = await kernel.browsers.create();
  ```

  ```python Python theme={null}
  # Uses default viewport (1920x1080@25Hz)
  default_viewport = kernel.browsers.create()
  ```
</CodeGroup>

## Setting viewport configuration

You can configure the viewport when creating a browser by specifying the `viewport` parameter with `width` and `height`. The `refresh_rate` is optional and will be automatically determined from the dimensions if they match a supported configuration:

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';

  const kernel = new Kernel();

  // Explicitly specify refresh rate
  const kernelBrowser = await kernel.browsers.create({
    viewport: {
      width: 1920,
      height: 1080,
      refresh_rate: 25
    }
  });

  // Auto-determine refresh rate from dimensions (25Hz for 1920x1080)
  const kernelBrowserAuto = await kernel.browsers.create({
    viewport: {
      width: 1920,
      height: 1080
    }
  });
  ```

  ```python Python theme={null}
  from kernel import Kernel

  kernel = Kernel()

  # Explicitly specify refresh rate
  kernel_browser = kernel.browsers.create(
      viewport={
          "width": 1920,
          "height": 1080,
          "refresh_rate": 25
      }
  )

  # Auto-determine refresh rate from dimensions (25Hz for 1920x1080)
  kernel_browser_auto = kernel.browsers.create(
      viewport={
          "width": 1920,
          "height": 1080
      }
  )
  ```
</CodeGroup>

<Note>
  The `refresh_rate` parameter only applies to live view sessions and is ignored for [headless](/browsers/headless) browsers.
</Note>

## Supported viewport configurations

Kernel supports specific viewport configurations. The server will reject unsupported combinations. When you provide width and height without specifying refresh\_rate, it will be automatically determined if the dimensions match one of the supported resolutions exactly. The following resolutions are supported:

| Resolution | Width | Height | Refresh Rate |
| ---------- | ----- | ------ | ------------ |
| QHD        | 2560  | 1440   | 10 Hz        |
| Full HD    | 1920  | 1080   | 25 Hz        |
| WUXGA      | 1920  | 1200   | 25 Hz        |
| WXGA+      | 1440  | 900    | 25 Hz        |
| WXGA       | 1280  | 800    | 60 Hz        |
| WXGA       | 1200  | 800    | 60 Hz        |
| XGA        | 1024  | 768    | 60 Hz        |

<Warning>
  Higher resolutions may affect the responsiveness of [live view](/browsers/live-view) browser sessions.
</Warning>

## Example configurations

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  // Full HD (1920x1080) at 25Hz - explicit refresh rate
  const fullHD = await kernel.browsers.create({
    viewport: {
      width: 1920,
      height: 1080,
      refresh_rate: 25
    }
  });

  // Full HD (1920x1080) - auto-determined 25Hz (Default configuration)
  const fullHDAuto = await kernel.browsers.create({
    viewport: {
      width: 1920,
      height: 1080
    }
  });

  // QHD (2560x1440) - auto-determined 10Hz
  // Note: May affect live view responsiveness
  const qhd = await kernel.browsers.create({
    viewport: {
      width: 2560,
      height: 1440
    }
  });

  // XGA (1024x768) - auto-determined 60Hz
  const xga = await kernel.browsers.create({
    viewport: {
      width: 1024,
      height: 768
    }
  });

  // WUXGA (1920x1200) at 25Hz - explicit refresh rate
  const wuxga = await kernel.browsers.create({
    viewport: {
      width: 1920,
      height: 1200,
      refresh_rate: 25
    }
  });
  ```

  ```python Python theme={null}
  # Full HD (1920x1080) at 25Hz - explicit refresh rate
  full_hd = kernel.browsers.create(
      viewport={
          "width": 1920,
          "height": 1080,
          "refresh_rate": 25
      }
  )

  # Full HD (1920x1080) - auto-determined 25Hz (Default configuration)
  full_hd_auto = kernel.browsers.create(
      viewport={
          "width": 1920,
          "height": 1080
      }
  )

  # QHD (2560x1440) - auto-determined 10Hz
  # Note: May affect live view responsiveness
  qhd = kernel.browsers.create(
      viewport={
          "width": 2560,
          "height": 1440
      }
  )

  # XGA (1024x768) - auto-determined 60Hz
  xga = kernel.browsers.create(
      viewport={
          "width": 1024,
          "height": 768
      }
  )

  # WUXGA (1920x1200) at 25Hz - explicit refresh rate
  wuxga = kernel.browsers.create(
      viewport={
          "width": 1920,
          "height": 1200,
          "refresh_rate": 25
      }
  )
  ```
</CodeGroup>

## Viewport constraints

Only the specific viewport configurations listed in the [supported configurations table](#supported-viewport-configurations) above are supported:

* **2560x1440** (QHD) at 10 Hz
* **1920x1080** (Full HD) at 25 Hz
* **1920x1200** (WUXGA) at 25 Hz
* **1440x900** (WXGA+) at 25 Hz
* **1280x800** (WXGA) at 60 Hz
* **1200x800** (WXGA) at 60 Hz
* **1024x768** (XGA) at 60 Hz

When specifying a viewport:

* **Width** and **Height** are required and must match one of the supported configurations exactly
* **Refresh Rate** is optional - if omitted, it will be automatically determined from the width and height combination

<Warning>
  The server will reject any viewport configuration that doesn't exactly match one of the supported combinations listed above.
</Warning>

## Changing viewport after browser creation

You can change the viewport of a browser after it has been created using the [update browser endpoint](/api-reference/browsers/update-browser-session).

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  // Create a browser with default viewport
  const kernelBrowser = await kernel.browsers.create();

  // Later, change the viewport
  await kernel.browsers.update(kernelBrowser.session_id, {
    viewport: {
      width: 1024,
      height: 768
    }
  });
  ```

  ```python Python theme={null}
  # Create a browser with default viewport
  kernel_browser = await kernel.browsers.create()

  # Later, change the viewport
  await kernel.browsers.update(kernel_browser.session_id, viewport={"width": 1024, "height": 768})
  ```
</CodeGroup>

<Warning>
  There are important limitations when changing the viewport:

  * **Headful browsers**: You cannot resize the viewport while [live view](/browsers/live-view) is active or while a [replay](/browsers/replays) is actively recording.
  * **Headless browsers**: Changing the viewport triggers a Chromium restart, which may disrupt active CDP connections.
</Warning>

## Considerations

* The viewport configuration is set when the browser is created and applies to the initial browser window
* Higher resolutions (like 2560x1440) may impact the performance and responsiveness of live view sessions
* The viewport size affects how websites render, especially those with responsive designs
* Screenshots taken from the browser will match the configured viewport dimensions
* In [headless mode](/browsers/headless), the viewport width and height still apply for rendering and screenshots, but the `refresh_rate` parameter is ignored
> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Overview

> Persist and reuse browser session state (cookies, local storage) across sessions

Profiles let you capture browser state created during a session (cookies and local storage) and reuse it in later sessions. This is useful for persisting login state or other site preferences across browser sessions.

<Tip>
  If you're looking to maintain authenticated browser sessions, check out [Managed Auth](/profiles/managed-auth/overview).
</Tip>

## 1. Create a profile

The first step in using profiles is to create one, optionally giving it a meaningful `name` that is unique within your organization.

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel, { ConflictError } from '@onkernel/sdk';

  const kernel = new Kernel();

  try {
    await kernel.profiles.create({ name: 'profiles-demo' });
  } catch (err) {
    if (err instanceof ConflictError) {
      // Profile already exists
    } else {
      throw err;
    }
  }
  ```

  ```python Python theme={null}
  from kernel import Kernel, ConflictError

  kernel = Kernel()

  try:
      await kernel.profiles.create(name="profiles-demo")
  except ConflictError:
      pass
  ```
</CodeGroup>

## 2. Start a browser session using the profile and save changes

After creating the profile, reference it by its `name` or `id` when creating a browser.
Set `save_changes` to true to persist any state created during this session back into the profile when the browser is closed.

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  const kernelBrowser = await kernel.browsers.create({
    profile: {
      name: 'profiles-demo',
      save_changes: true,
    },
  });
  ```

  ```python Python theme={null}
  kernel_browser = await kernel.browsers.create(
      profile={
          "name": "profiles-demo",
          "save_changes": True,
      }
  )
  ```
</CodeGroup>

## 3. Use the browser, then close it to persist the state

After using a browser with `save_changes: true`, closing the browser will save cookies and local storage into the profile.

<Warning>
  Calling `browser.close()` does **not** save the profile state. You **must** explicitly delete the Kernel browser (or let the browser [timeout](/browsers/termination#automatic-deletion-via-timeout)) to persist the Profile.
</Warning>

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  console.log('Live view:', kernelBrowser.browser_live_view_url);

  // Navigate and create login state...

  await kernel.browsers.deleteByID(kernelBrowser.session_id);
  ```

  ```python Python theme={null}
  print("Live view:", kernel_browser.browser_live_view_url)

  # Navigate and create login state...

  await kernel.browsers.delete_by_id(kernel_browser.session_id)
  ```
</CodeGroup>

## 4. Start a new session with the saved profile (read-only)

Create another browser using the same profile name. Omitting `save_changes` leaves the stored profile untouched.

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  const kernelBrowser2 = await kernel.browsers.create({
    profile: { name: 'profiles-demo' },
  });

  console.log('Live view:', kernelBrowser2.browser_live_view_url);
  ```

  ```python Python theme={null}
  kernel_browser2 = await kernel.browsers.create(
      profile={"name": "profiles-demo"}
  )
  print("Live view:", kernel_browser2.browser_live_view_url)
  ```
</CodeGroup>

## Loading a profile into an existing browser

You can load a profile into a browser after it has been created using the [update browser endpoint](/api-reference/browsers/update-browser-session).

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  // Create a browser without a profile
  const kernelBrowser = await kernel.browsers.create();

  // Later, load a profile into the browser
  await kernel.browsers.update(kernelBrowser.session_id, {
    profile: { name: 'profiles-demo' }
  });
  ```

  ```python Python theme={null}
  # Create a browser without a profile
  kernel_browser = await kernel.browsers.create()

  # Later, load a profile into the browser
  await kernel.browsers.update(kernel_browser.session_id, profile={"name": "profiles-demo"})
  ```
</CodeGroup>

<Warning>
  You cannot load a profile into a browser that was already created with a profile. The browser must have been created without any profile configuration.
</Warning>

## Other ways to use profiles

The API and SDKs support listing, deleting, and downloading profile data as JSON. See the [API reference](/api-reference/profiles/list-profiles) for more details.

## Notes

* A profile's `name` must be unique within your organization.
* Profiles store cookies and local storage. Start the session with `save_changes: true` to write changes back when the browser is closed.
* To keep a profile immutable for a run, omit `save_changes` (default) when creating the browser.
* Multiple browsers in parallel can use the same profile, but only one browser should write (`save_changes: true`) to it at a time. Parallel browsers with `save_changes: true` may cause profile corruption and unpredictable behavior.
* Profile data is encrypted end to end using a per-organization key.
> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Overview

> Create authenticated browser sessions for your automations

<Note>
  Managed Auth is currently in public beta. Features are subject to change.
</Note>

Managed Auth creates and maintains authenticated browser profiles for your AI agents and web automations. Store credentials once, and Kernel re-authenticates automatically when needed. When you launch a browser with the managed profile, you're already logged in and ready to go.

## How It Works

<Steps>
  <Step title="Create a Connection">
    A **Managed Auth Connection** links a profile to a website domain. Create one for each domain + profile combination you want to keep authenticated.

    <CodeGroup>
      ```typescript TypeScript theme={null}
      const auth = await kernel.auth.connections.create({
        domain: 'netflix.com',
        profile_name: 'netflix-user-123',
      });
      ```

      ```python Python theme={null}
      auth = await kernel.auth.connections.create(
          domain="netflix.com",
          profile_name="netflix-user-123",
      )
      ```
    </CodeGroup>
  </Step>

  <Step title="Start a Login Session">
    A **Managed Auth Session** is the corresponding login flow for the specified connection. Users provide credentials via a Kernel-hosted page or your own UI.

    Specify a [Credential](/profiles/credentials) to enable re-authentication without user input.

    <CodeGroup>
      ```typescript TypeScript theme={null}
      const login = await kernel.auth.connections.login(auth.id);

      // Send user to login page
      console.log('Login URL:', login.hosted_url);

      // Poll until complete
      let state = await kernel.auth.connections.retrieve(auth.id);
      while (state.flow_status === 'IN_PROGRESS') {
        await new Promise(r => setTimeout(r, 2000));
        state = await kernel.auth.connections.retrieve(auth.id);
      }

      if (state.status === 'AUTHENTICATED') {
        console.log('Authenticated!');
      }
      ```

      ```python Python theme={null}
      login = await kernel.auth.connections.login(auth.id)

      # Send user to login page
      print(f"Login URL: {login.hosted_url}")

      # Poll until complete
      state = await kernel.auth.connections.retrieve(auth.id)
      while state.flow_status == "IN_PROGRESS":
          await asyncio.sleep(2)
          state = await kernel.auth.connections.retrieve(auth.id)

      if state.status == "AUTHENTICATED":
          print("Authenticated!")
      ```
    </CodeGroup>
  </Step>

  <Step title="Use the Profile">
    Once the auth connection completes, create browsers with the profile and navigate to the site. The browser session will already be authenticated.

    <CodeGroup>
      ```typescript TypeScript theme={null}
      const browser = await kernel.browsers.create({
        profile: { name: 'netflix-user-123' },
        stealth: true,
      });

      // Navigate to the site—you're already logged in
      await page.goto('https://netflix.com');
      ```

      ```python Python theme={null}
      browser = await kernel.browsers.create(
          profile={"name": "netflix-user-123"},
          stealth=True,
      )

      # Navigate to the site—you're already logged in
      await page.goto("https://netflix.com")
      ```
    </CodeGroup>
  </Step>
</Steps>

## Choose Your Integration

<CardGroup cols={2}>
  <Card title="Hosted UI" icon="browser" href="/profiles/managed-auth/hosted-ui">
    **Start here** - Simplest integration

    Redirect users to Kernel's hosted page. Add features incrementally: save credentials for auto-reauth, custom login URLs, SSO support.
  </Card>

  <Card title="Programmatic" icon="code" href="/profiles/managed-auth/programmatic">
    **Full control** - Custom UI or headless

    Build your own credential collection. Handle login fields, SSO buttons, MFA selection, and external actions (push notifications, security keys).
  </Card>
</CardGroup>

## Why Managed Auth?

The most valuable workflows live behind logins. Managed Auth provides:

* **Works on any website** - Login pages are discovered and handled automatically
* **SSO/OAuth support** - "Sign in with Google/GitHub/Microsoft" buttons work out-of-the-box via `allowed_domains`
* **2FA/OTP handling** - TOTP codes automated, SMS/email/push OTP are supported
* **Post-login URL** - Get the URL where login landed (`post_login_url`) so you can start automations from the right page
* **Session monitoring** - Automatic re-authentication when sessions expire with stored credentials
* **Secure by default** - Credentials encrypted at rest, never exposed in API responses, or passed to LLMs

## Security

| Feature                    | Description                                        |
| -------------------------- | -------------------------------------------------- |
| **Encrypted credentials**  | Values encrypted with per-organization keys        |
| **No credential exposure** | Never returned in API responses or passed to LLMs  |
| **Encrypted profiles**     | Browser session state encrypted end-to-end         |
| **Isolated execution**     | Each login runs in an isolated browser environment |
> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Hosted UI

> The simplest way to create authenticated browser sessions

Collect credentials securely via Kernel's hosted page, then use the authenticated session in your automations. This is the recommended approach for most applications.

Use the Hosted UI when:

* You need users to provide their credentials
* You want the simplest integration with minimal code
* You want Kernel to handle 2FA and multi-step login flows

## Getting started

### 1. Create a Connection

A Managed Auth Connection links a profile to a domain you want to keep authenticated.

<CodeGroup>
  ```typescript TypeScript theme={null}
  const auth = await kernel.auth.connections.create({
    domain: 'linkedin.com',
    profile_name: 'linkedin-profile',
  });
  ```

  ```python Python theme={null}
  auth = await kernel.auth.connections.create(
      domain="linkedin.com",
      profile_name="linkedin-profile",
  )
  ```
</CodeGroup>

### 2. Start a Login Session

Start a Managed Auth Session to get the hosted login URL.

<CodeGroup>
  ```typescript TypeScript theme={null}
  const login = await kernel.auth.connections.login(auth.id);
  ```

  ```python Python theme={null}
  login = await kernel.auth.connections.login(auth.id)
  ```
</CodeGroup>

### 3. Collect Credentials

Send the user to the hosted login page:

<CodeGroup>
  ```typescript TypeScript theme={null}
  window.location.href = login.hosted_url;
  ```

  ```python Python theme={null}
  # Return the URL to your frontend
  print(f"Redirect to: {login.hosted_url}")
  ```
</CodeGroup>

The user will:

1. See the login page for the target website
2. Enter their credentials
3. Complete 2FA if needed

### 4. Poll for Completion

On your backend, poll until authentication completes:

<CodeGroup>
  ```typescript TypeScript theme={null}
  let state = await kernel.auth.connections.retrieve(auth.id);

  while (state.flow_status === 'IN_PROGRESS') {
    await new Promise(r => setTimeout(r, 2000));
    state = await kernel.auth.connections.retrieve(auth.id);
  }

  if (state.status === 'AUTHENTICATED') {
    console.log('Authentication successful!');
  }
  ```

  ```python Python theme={null}
  state = await kernel.auth.connections.retrieve(auth.id)

  while state.flow_status == "IN_PROGRESS":
      await asyncio.sleep(2)
      state = await kernel.auth.connections.retrieve(auth.id)

  if state.status == "AUTHENTICATED":
      print("Authentication successful!")
  ```
</CodeGroup>

<Info>
  Poll every 2 seconds. The session expires after 20 minutes if not completed, and the flow times out after 10 minutes of waiting for user input.
</Info>

### 5. Use the Profile

Create browsers with the profile and navigate to the site. The browser session will already be authenticated:

<CodeGroup>
  ```typescript TypeScript theme={null}
  const browser = await kernel.browsers.create({
    profile: { name: 'linkedin-profile' },
    stealth: true,
  });

  // Navigate to the site—you're already logged in
  await page.goto('https://linkedin.com');
  ```

  ```python Python theme={null}
  browser = await kernel.browsers.create(
      profile={"name": "linkedin-profile"},
      stealth=True,
  )

  # Navigate to the site—you're already logged in
  await page.goto("https://linkedin.com")
  ```
</CodeGroup>

<Info>
  Managed Auth Connections are generated using Kernel's [stealth](/browsers/bot-detection/stealth) mode. Use `stealth: true` when creating authenticated browser sessions for the best experience.
</Info>

## Complete Example

<CodeGroup>
  ```typescript TypeScript theme={null}
  import Kernel from '@onkernel/sdk';

  const kernel = new Kernel();

  // Create connection
  const auth = await kernel.auth.connections.create({
    domain: 'doordash.com',
    profile_name: 'doordash-user-123',
  });

  // Start authentication
  const login = await kernel.auth.connections.login(auth.id);

  // Send user to hosted page
  console.log('Login URL:', login.hosted_url);

  // Poll for completion
  let state = await kernel.auth.connections.retrieve(auth.id);
  while (state.flow_status === 'IN_PROGRESS') {
    await new Promise(r => setTimeout(r, 2000));
    state = await kernel.auth.connections.retrieve(auth.id);
  }

  if (state.status === 'AUTHENTICATED') {
    const browser = await kernel.browsers.create({
      profile: { name: 'doordash-user-123' },
      stealth: true,
    });
    
    // Navigate to the site—you're already logged in
    await page.goto('https://doordash.com');
  }
  ```

  ```python Python theme={null}
  from kernel import Kernel
  import asyncio

  kernel = Kernel()

  # Create connection
  auth = await kernel.auth.connections.create(
      domain="doordash.com",
      profile_name="doordash-user-123",
  )

  # Start authentication
  login = await kernel.auth.connections.login(auth.id)

  # Send user to hosted page
  print(f"Login URL: {login.hosted_url}")

  # Poll for completion
  state = await kernel.auth.connections.retrieve(auth.id)
  while state.flow_status == "IN_PROGRESS":
      await asyncio.sleep(2)
      state = await kernel.auth.connections.retrieve(auth.id)

  if state.status == "AUTHENTICATED":
      browser = await kernel.browsers.create(
          profile={"name": "doordash-user-123"},
          stealth=True,
      )
      
      # Navigate to the site—you're already logged in
      await page.goto("https://doordash.com")
  ```
</CodeGroup>

## Adding Features

The basic flow above gets you started. Add these features as needed:

### Credentials and Auto-Reauth

Credentials are saved after every successful login, enabling automatic re-authentication when the session expires. One-time codes (TOTP, SMS, etc.) are not saved.

To opt out of credential saving, set `save_credentials: false` when creating the connection. See [Credentials](/profiles/credentials) for more on automated authentication.

### Custom Login URL

If the site's login page isn't at the default location, specify it when creating the connection:

<CodeGroup>
  ```typescript TypeScript theme={null}
  const auth = await kernel.auth.connections.create({
    domain: 'example.com',
    profile_name: 'my-profile',
    login_url: 'https://example.com/auth/signin',
  });
  ```

  ```python Python theme={null}
  auth = await kernel.auth.connections.create(
      domain="example.com",
      profile_name="my-profile",
      login_url="https://example.com/auth/signin",
  )
  ```
</CodeGroup>

### SSO/OAuth Support

Sites with "Sign in with Google/GitHub/Microsoft" are supported. The user completes the OAuth flow with the provider, and the authenticated session is automatically saved to the Kernel profile.

Make sure to add all of the OAuth provider's domains to `allowed_domains`:

<CodeGroup>
  ```typescript TypeScript theme={null}
  const auth = await kernel.auth.connections.create({
    domain: 'example.com',
    profile_name: 'my-profile',
    allowed_domains: ['accounts.google.com', 'google.com'],
  });
  ```

  ```python Python theme={null}
  auth = await kernel.auth.connections.create(
      domain="example.com",
      profile_name="my-profile",
      allowed_domains=["accounts.google.com", "google.com"],
  )
  ```
</CodeGroup>

### Post-Login URL

After successful authentication, `post_login_url` will be set to the page where the login landed. Use this start your automation from the right place:

<CodeGroup>
  ```typescript TypeScript theme={null}
  const managedAuth = await kernel.auth.connections.retrieve(auth.id);

  if (managedAuth.post_login_url) {
    await page.goto(managedAuth.post_login_url);
    // Start automation from the dashboard/home page
  }
  ```

  ```python Python theme={null}
  managed_auth = await kernel.auth.connections.retrieve(auth.id)

  if managed_auth.post_login_url:
      await page.goto(managed_auth.post_login_url)
      # Start automation from the dashboard/home page
  ```
</CodeGroup>
> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Programmatic Flow

> Build your own credential collection UI with full control

Build your own credential collection UI instead of using the hosted page. Poll for login fields, then submit credentials via the API.

Use the Programmatic flow when:

* You need a custom credential collection UI that matches your app's design
* You're building headless/automated authentication
* You have credentials stored and want to authenticate without user interaction

## How It Works

<Steps>
  <Step title="Create Connection and Start Session">
    Same as [Hosted UI](/profiles/managed-auth/hosted-ui)
  </Step>

  <Step title="Poll and Submit">
    Poll until `flow_step` becomes `AWAITING_INPUT`, then submit credentials
  </Step>

  <Step title="Handle 2FA">
    If more fields appear (2FA code), submit again—same loop handles it
  </Step>
</Steps>

## Getting started

### 1. Create a Connection

<CodeGroup>
  ```typescript TypeScript theme={null}
  const auth = await kernel.auth.connections.create({
    domain: 'github.com',
    profile_name: 'github-profile',
  });
  ```

  ```python Python theme={null}
  auth = await kernel.auth.connections.create(
      domain="github.com",
      profile_name="github-profile",
  )
  ```
</CodeGroup>

### 2. Start a Login Session

<CodeGroup>
  ```typescript TypeScript theme={null}
  const login = await kernel.auth.connections.login(auth.id);
  ```

  ```python Python theme={null}
  login = await kernel.auth.connections.login(auth.id)
  ```
</CodeGroup>

Credentials are saved automatically on successful login, enabling automatic re-authentication when the session expires.

### 3. Poll and Submit Credentials

A single loop handles everything—initial login, 2FA, and completion:

<CodeGroup>
  ```typescript TypeScript theme={null}
  let state = await kernel.auth.connections.retrieve(auth.id);

  while (state.flow_status === 'IN_PROGRESS') {
    // Submit when fields are ready (login or 2FA)
    if (state.flow_step === 'AWAITING_INPUT' && state.discovered_fields?.length) {
      const fieldValues = getCredentialsForFields(state.discovered_fields);
      await kernel.auth.connections.submit(auth.id, { fields: fieldValues });
    }
    
    await new Promise(r => setTimeout(r, 2000));
    state = await kernel.auth.connections.retrieve(auth.id);
  }

  if (state.status === 'AUTHENTICATED') {
    console.log('Authentication successful!');
  }
  ```

  ```python Python theme={null}
  state = await kernel.auth.connections.retrieve(auth.id)

  while state.flow_status == "IN_PROGRESS":
      # Submit when fields are ready (login or 2FA)
      if state.flow_step == "AWAITING_INPUT" and state.discovered_fields:
          field_values = get_credentials_for_fields(state.discovered_fields)
          await kernel.auth.connections.submit(auth.id, fields=field_values)
      
      await asyncio.sleep(2)
      state = await kernel.auth.connections.retrieve(auth.id)

  if state.status == "AUTHENTICATED":
      print("Authentication successful!")
  ```
</CodeGroup>

The `discovered_fields` array tells you what the login form needs:

```typescript  theme={null}
// Example discovered_fields for login
[{ name: 'username', type: 'text' }, { name: 'password', type: 'password' }]

// Example discovered_fields for 2FA
[{ name: 'otp', type: 'code' }]
```

## Complete Example

<CodeGroup>
  ```typescript TypeScript theme={null}
  import Kernel from '@onkernel/sdk';

  const kernel = new Kernel();

  // Create connection
  const auth = await kernel.auth.connections.create({
    domain: 'github.com',
    profile_name: 'github-profile',
  });

  const login = await kernel.auth.connections.login(auth.id);

  // Single polling loop handles login + 2FA
  let state = await kernel.auth.connections.retrieve(auth.id);

  while (state.flow_status === 'IN_PROGRESS') {
    if (state.flow_step === 'AWAITING_INPUT' && state.discovered_fields?.length) {
      // Check what fields are needed
      const fieldNames = state.discovered_fields.map(f => f.name);
      
      if (fieldNames.includes('username')) {
        // Initial login
        await kernel.auth.connections.submit(auth.id, {
          fields: { username: 'my-username', password: 'my-password' }
        });
      } else {
        // 2FA or additional fields
        const code = await promptUserForCode();
        await kernel.auth.connections.submit(auth.id, {
          fields: { [state.discovered_fields[0].name]: code }
        });
      }
    }

    await new Promise(r => setTimeout(r, 2000));
    state = await kernel.auth.connections.retrieve(auth.id);
  }

  if (state.status === 'AUTHENTICATED') {
    console.log('Authentication successful!');
    
    const browser = await kernel.browsers.create({
      profile: { name: 'github-profile' },
      stealth: true,
    });
    
    // Navigate to the site—you're already logged in
    await page.goto('https://github.com');
  }
  ```

  ```python Python theme={null}
  from kernel import Kernel
  import asyncio

  kernel = Kernel()

  # Create connection
  auth = await kernel.auth.connections.create(
      domain="github.com",
      profile_name="github-profile",
  )

  login = await kernel.auth.connections.login(auth.id)

  # Single polling loop handles login + 2FA
  state = await kernel.auth.connections.retrieve(auth.id)

  while state.flow_status == "IN_PROGRESS":
      if state.flow_step == "AWAITING_INPUT" and state.discovered_fields:
          # Check what fields are needed
          field_names = [f["name"] for f in state.discovered_fields]
          
          if "username" in field_names:
              # Initial login
              await kernel.auth.connections.submit(
                  auth.id,
                  fields={"username": "my-username", "password": "my-password"},
              )
          else:
              # 2FA or additional fields
              code = input("Enter code: ")
              await kernel.auth.connections.submit(
                  auth.id,
                  fields={state.discovered_fields[0]["name"]: code},
              )

      await asyncio.sleep(2)
      state = await kernel.auth.connections.retrieve(auth.id)

  if state.status == "AUTHENTICATED":
      print("Authentication successful!")
      
      browser = await kernel.browsers.create(
          profile={"name": "github-profile"},
          stealth=True,
      )
      
      # Navigate to the site—you're already logged in
      await page.goto("https://github.com")
  ```
</CodeGroup>

## Handling Different Input Types

The basic polling loop handles `discovered_fields`, but login pages can require other input types too.

### SSO Buttons

When the login page has "Sign in with Google/GitHub/Microsoft" buttons, they appear in `pending_sso_buttons`:

<CodeGroup>
  ```typescript TypeScript theme={null}
  if (state.pending_sso_buttons?.length) {
    // Show the user available SSO options
    for (const btn of state.pending_sso_buttons) {
      console.log(`${btn.provider}: ${btn.label}`);
    }
    
    // Submit the selected SSO button
    await kernel.auth.connections.submit(auth.id, {
      sso_button_selector: state.pending_sso_buttons[0].selector
    });
  }
  ```

  ```python Python theme={null}
  if state.pending_sso_buttons:
      # Show the user available SSO options
      for btn in state.pending_sso_buttons:
          print(f"{btn['provider']}: {btn['label']}")
      
      # Submit the selected SSO button
      await kernel.auth.connections.submit(
          auth.id,
          sso_button_selector=state.pending_sso_buttons[0]["selector"],
      )
  ```
</CodeGroup>

<Info>
  Remember to set `allowed_domains` on the connection to include the OAuth provider's domain (e.g., `accounts.google.com`).
</Info>

### MFA Selection

When the site offers multiple MFA methods, they appear in `mfa_options`:

<CodeGroup>
  ```typescript TypeScript theme={null}
  if (state.mfa_options?.length) {
    // Available types: sms, email, totp, push, call, security_key
    for (const opt of state.mfa_options) {
      console.log(`${opt.type}: ${opt.label}`);
    }
    
    // Submit the selected MFA method
    await kernel.auth.connections.submit(auth.id, {
      mfa_option_id: 'sms'
    });
  }
  ```

  ```python Python theme={null}
  if state.mfa_options:
      # Available types: sms, email, totp, push, call, security_key
      for opt in state.mfa_options:
          print(f"{opt['type']}: {opt['label']}")
      
      # Submit the selected MFA method
      await kernel.auth.connections.submit(
          auth.id,
          mfa_option_id="sms",
      )
  ```
</CodeGroup>

After selecting an MFA method, the flow continues. Poll for `discovered_fields` to submit the code, or handle external actions for push/security key.

### External Actions (Push, Security Key)

When the site requires an action outside the browser (push notification, security key tap), the step becomes `AWAITING_EXTERNAL_ACTION`:

<CodeGroup>
  ```typescript TypeScript theme={null}
  if (state.flow_step === 'AWAITING_EXTERNAL_ACTION') {
    // Show the message to the user
    console.log(state.external_action_message);
    // e.g., "Check your phone for a push notification"
    
    // Keep polling—the flow resumes automatically when the user completes the action
  }
  ```

  ```python Python theme={null}
  if state.flow_step == "AWAITING_EXTERNAL_ACTION":
      # Show the message to the user
      print(state.external_action_message)
      # e.g., "Check your phone for a push notification"
      
      # Keep polling—the flow resumes automatically when the user completes the action
  ```
</CodeGroup>

## Step Reference

The `flow_step` field indicates what the flow is waiting for:

| Step                       | Description                                                  |
| -------------------------- | ------------------------------------------------------------ |
| `DISCOVERING`              | Finding the login page and analyzing it                      |
| `AWAITING_INPUT`           | Waiting for field values, SSO button click, or MFA selection |
| `SUBMITTING`               | Processing submitted values                                  |
| `AWAITING_EXTERNAL_ACTION` | Waiting for push approval, security key, etc.                |
| `COMPLETED`                | Flow has finished                                            |

## Status Reference

The `flow_status` field indicates the current flow state:

| Status        | Description                                                    |
| ------------- | -------------------------------------------------------------- |
| `IN_PROGRESS` | Authentication is ongoing—keep polling                         |
| `SUCCESS`     | Login completed, profile saved                                 |
| `FAILED`      | Login failed (check `error_message`)                           |
| `EXPIRED`     | Flow timed out (10 minutes for user input, 20 minutes overall) |
| `CANCELED`    | Flow was canceled                                              |

The `status` field indicates the overall connection state:

| Status          | Description                           |
| --------------- | ------------------------------------- |
| `AUTHENTICATED` | Profile is logged in and ready to use |
| `NEEDS_AUTH`    | Profile needs authentication          |

## Real-Time Updates with SSE

For real-time UIs, you can stream login flow events via Server-Sent Events instead of polling:

```
GET /auth/connections/{id}/events
```

The stream delivers `managed_auth_state` events with the same fields as polling (`flow_status`, `flow_step`, `discovered_fields`, etc.) and terminates automatically when the flow reaches a terminal state.

<Note>
  Polling is recommended for most integrations. SSE is useful when building real-time UIs that need instant updates without polling delays.
</Note>
> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Credentials

> Automate authentication with stored credentials

Credentials allow you to store login information securely and enable Kernel's automated re-authentication without requiring user interaction.

**There are three ways to provide credentials:**

* **Automatically save during login** — Capture credentials directly from the user when they log in via [Hosted UI](/profiles/managed-auth/hosted-ui) or [Programmatic](/profiles/managed-auth/programmatic)
* **Pre-store in Kernel** — Create credentials before any login for fully headless automation
* **Connect 1Password** — Use credentials from your existing 1Password vaults

<Card title="1Password Integration" icon="key" href="/integrations/1password">
  Connect your 1Password vaults to automatically use existing credentials with Managed Auth. Credentials are automatically matched by domain.
</Card>

## Save credentials during login

By default, credentials entered during login are automatically saved for re-authentication. No extra parameters are needed:

<CodeGroup>
  ```typescript TypeScript theme={null}
  const login = await kernel.auth.connections.login(auth.id);
  ```

  ```python Python theme={null}
  login = await kernel.auth.connections.login(auth.id)
  ```
</CodeGroup>

Once saved, the profile stays authenticated automatically. When the session expires, Kernel re-authenticates using the stored credentials. Credentials are updated after every successful login. One-time codes (TOTP, SMS, etc.) are not saved.

To opt out of credential saving, set `save_credentials: false` when creating the connection:

<CodeGroup>
  ```typescript TypeScript theme={null}
  const auth = await kernel.auth.connections.create({
    domain: 'example.com',
    profile_name: 'my-profile',
    save_credentials: false,
  });
  ```

  ```python Python theme={null}
  auth = await kernel.auth.connections.create(
      domain="example.com",
      profile_name="my-profile",
      save_credentials=False,
  )
  ```
</CodeGroup>

## Pre-store credentials

For fully automated flows where no user is involved, create credentials upfront:

<CodeGroup>
  ```typescript TypeScript theme={null}
  const credential = await kernel.credentials.create({
    name: 'my-netflix-login',
    domain: 'netflix.com',
    values: {
      email: 'user@netflix.com',
      password: 'secretpassword123',
    },
  });
  ```

  ```python Python theme={null}
  credential = await kernel.credentials.create(
      name="my-netflix-login",
      domain="netflix.com",
      values={
          "email": "user@netflix.com",
          "password": "secretpassword123",
      },
  )
  ```
</CodeGroup>

Then link the credential when creating a connection:

<CodeGroup>
  ```typescript TypeScript theme={null}
  const auth = await kernel.auth.connections.create({
    domain: 'netflix.com',
    profile_name: 'my-profile',
    credential: { name: credential.name },
  });

  // Start login - authenticates automatically using stored credentials
  const login = await kernel.auth.connections.login(auth.id);
  ```

  ```python Python theme={null}
  auth = await kernel.auth.connections.create(
      domain="netflix.com",
      profile_name="my-profile",
      credential={"name": credential.name},
  )

  # Start login - authenticates automatically using stored credentials
  login = await kernel.auth.connections.login(auth.id)
  ```
</CodeGroup>

### 2FA with TOTP

For sites with authenticator app 2FA, include `totp_secret` to fully automate login:

<CodeGroup>
  ```typescript TypeScript theme={null}
  const credential = await kernel.credentials.create({
    name: 'my-login',
    domain: 'github.com',
    values: {
      username: 'my-username',
      password: 'my-password',
    },
    totp_secret: 'JBSWY3DPEHPK3PXP',  // From authenticator app setup
  });
  ```

  ```python Python theme={null}
  credential = await kernel.credentials.create(
      name="my-login",
      domain="github.com",
      values={
          "username": "my-username",
          "password": "my-password",
      },
      totp_secret="JBSWY3DPEHPK3PXP",  # From authenticator app setup
  )
  ```
</CodeGroup>

### SSO / OAuth

For sites with "Sign in with Google/GitHub/Microsoft", set `sso_provider` and include the OAuth provider's domains in `allowed_domains`.

The workflow automatically clicks the matching SSO button and completes OAuth:

<CodeGroup>
  ```typescript TypeScript theme={null}
  const credential = await kernel.credentials.create({
    name: 'my-google-login',
    domain: 'accounts.google.com',
    sso_provider: 'google',
    values: {
      email: 'user@gmail.com',
      password: 'password',
    },
  });

  const auth = await kernel.auth.connections.create({
    domain: 'target-site.com',
    profile_name: 'my-profile',
    credential: { name: credential.name },
    allowed_domains: ['accounts.google.com', 'google.com'],
  });
  ```

  ```python Python theme={null}
  credential = await kernel.credentials.create(
      name="my-google-login",
      domain="accounts.google.com",
      sso_provider="google",
      values={
          "email": "user@gmail.com",
          "password": "password",
      },
  )

  auth = await kernel.auth.connections.create(
      domain="target-site.com",
      profile_name="my-profile",
      credential={"name": credential.name},
      allowed_domains=["accounts.google.com", "google.com"],
  )
  ```
</CodeGroup>

## Partial Credentials

Credentials don't need to contain every field required by the login form. You can store what you have and collect the necessary fields from the user. `auth.connections.login()` pauses for missing values.

As an example, the below credential has email + TOTP secret stored (and automatically handled), but no password. The password is dynamically collected from the user using Kernel's Hosted UI or your Programmatic flow:

<CodeGroup>
  ```typescript TypeScript theme={null}
  const credential = await kernel.credentials.create({
    name: 'my-login',
    domain: 'example.com',
    values: { email: 'user@example.com' },  // No password
    totp_secret: 'JBSWY3DPEHPK3PXP',
  });

  const auth = await kernel.auth.connections.create({
    domain: 'example.com',
    profile_name: 'my-profile',
    credential: { name: credential.name },
  });

  const login = await kernel.auth.connections.login(auth.id);

  // Poll until password is needed
  let state = await kernel.auth.connections.retrieve(auth.id);
  while (state.flow_status === 'IN_PROGRESS') {
    if (state.flow_step === 'AWAITING_INPUT' && state.discovered_fields?.length) {
      // Only password field will be pending (email auto-filled from credential)
      await kernel.auth.connections.submit(auth.id, {
        fields: { password: 'user-provided-password' }
      });
    }
    await new Promise(r => setTimeout(r, 2000));
    state = await kernel.auth.connections.retrieve(auth.id);
  }
  // TOTP auto-submitted from credential → SUCCESS
  ```

  ```python Python theme={null}
  credential = await kernel.credentials.create(
      name="my-login",
      domain="example.com",
      values={"email": "user@example.com"},  # No password
      totp_secret="JBSWY3DPEHPK3PXP",
  )

  auth = await kernel.auth.connections.create(
      domain="example.com",
      profile_name="my-profile",
      credential={"name": credential.name},
  )

  login = await kernel.auth.connections.login(auth.id)

  # Poll until password is needed
  state = await kernel.auth.connections.retrieve(auth.id)
  while state.flow_status == "IN_PROGRESS":
      if state.flow_step == "AWAITING_INPUT" and state.discovered_fields:
          # Only password field will be pending (email auto-filled from credential)
          await kernel.auth.connections.submit(
              auth.id,
              fields={"password": "user-provided-password"},
          )
      await asyncio.sleep(2)
      state = await kernel.auth.connections.retrieve(auth.id)
  # TOTP auto-submitted from credential → SUCCESS
  ```
</CodeGroup>

This is useful when you want to:

* Store TOTP secrets but have users enter their password each time
* Pre-fill username/email but collect password at runtime
* Merge user-provided values into an existing credential automatically on successful login

## Security

| Feature                | Description                                          |
| ---------------------- | ---------------------------------------------------- |
| **Encrypted at rest**  | Values encrypted using per-organization keys         |
| **Write-only**         | Values cannot be retrieved via API after creation    |
| **Never logged**       | Values are never written to logs                     |
| **Never shared**       | Values are never passed to LLMs                      |
| **Isolated execution** | Authentication runs in isolated browser environments |

## Notes

* The `values` object is flexible and can be used to store whatever fields the login form needs (`email`, `username`, `company_id`, etc.)
* Deleting a credential unlinks it from associated connections so they can no longer auto-authenticate
* Use one credential per account. We recommend creating separate credentials for different user accounts
> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# File I/O

> Downloads, uploads, and manipulating the browser's filesystem

## Downloads

Kernel browsers run in fully sandboxed environments with writable filesystems. When your automation downloads a file, it's saved inside the browser's filesystem and can be retrieved using Kernel's File I/O APIs.

<Warning>
  Files can only be retrieved while the browser session is still active. Once the browser session is destroyed or times out, all files from that session are permanently deleted and no longer accessible.
</Warning>

### Playwright

Playwright performs downloads via the browser itself, so there are a few steps:

* Create a browser session
* Configure browser download behavior using CDP
* Perform the download
* Retrieve the file from the browser's filesystem

<Note>
  With `behavior: 'default'`, downloads are saved to the browser's default download directory. The CDP `downloadProgress` event includes a `filePath` field when the download completes, which tells you exactly where the file was saved. Use this path with Kernel's File I/O APIs to retrieve the file.
</Note>

<Info>
  The CDP `downloadProgress` event signals when the browser finishes writing a
  file, but there may be a brief delay before the file becomes available through
  Kernel's File I/O APIs. This is especially true for larger downloads. We
  recommend polling `listFiles` to confirm the file exists before attempting to
  read it.
</Info>

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';
  import { chromium } from 'playwright';
  import fs from 'fs';
  import path from 'path';
  import pTimeout from 'p-timeout';

  const kernel = new Kernel();

  // Poll listFiles until the expected file appears in the directory
  async function waitForFile(
    sessionId: string,
    filePath: string,
    timeoutMs = 30_000
  ) {
    const dir = path.dirname(filePath);
    const filename = path.basename(filePath);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const files = await kernel.browsers.fs.listFiles(sessionId, { path: dir });
      if (files.some((f) => f.name === filename)) {
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`File ${filePath} not found after ${timeoutMs}ms`);
  }

  async function main() {
    const kernelBrowser = await kernel.browsers.create();
    console.log('live view:', kernelBrowser.browser_live_view_url);

    const browser = await chromium.connectOverCDP(kernelBrowser.cdp_ws_url);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());

    const client = await context.newCDPSession(page);
    await client.send('Browser.setDownloadBehavior', {
      behavior: 'default',
      eventsEnabled: true,
    });

    // Set up CDP listeners to capture download path and completion
    let downloadFilePath: string | undefined;
    let downloadState: string | undefined;
    let downloadCompletedResolve!: () => void;
    const downloadCompleted = new Promise<void>((resolve) => {
      downloadCompletedResolve = resolve;
    });

    client.on('Browser.downloadWillBegin', (event) => {
      console.log('Download started:', event.suggestedFilename);
    });

    client.on('Browser.downloadProgress', (event) => {
      if (event.state === 'completed' || event.state === 'canceled') {
        downloadState = event.state;
        downloadFilePath = event.filePath;
        downloadCompletedResolve();
      }
    });

    console.log('Navigating to download test page');
    await page.goto('https://browser-tests-alpha.vercel.app/api/download-test');
    await page.getByRole('link', { name: 'Download File' }).click();

    try {
      await pTimeout(downloadCompleted, {
        milliseconds: 10_000,
        message: new Error('Download timed out after 10 seconds'),
      });
      console.log('Download completed');
    } catch (err) {
      console.error(err);
      throw err;
    }

    if (downloadState === 'canceled') {
      throw new Error('Download was canceled');
    }

    if (!downloadFilePath) {
      throw new Error('Unable to determine download file path');
    }

    // Wait for the file to be available via Kernel's File I/O APIs
    console.log(`Waiting for file: ${downloadFilePath}`);
    await waitForFile(kernelBrowser.session_id, downloadFilePath);

    console.log(`Reading file: ${downloadFilePath}`);

    const resp = await kernel.browsers.fs.readFile(kernelBrowser.session_id, {
      path: downloadFilePath,
    });

    const bytes = await resp.bytes();
    fs.mkdirSync('downloads', { recursive: true });
    const localPath = `downloads/${path.basename(downloadFilePath)}`;
    fs.writeFileSync(localPath, bytes);
    console.log(`Saved to ${localPath}`);

    await kernel.browsers.deleteByID(kernelBrowser.session_id);
    console.log('Kernel browser deleted successfully.');
  }

  main();

  ```

  ```python Python theme={null}
  import asyncio
  import os
  from pathlib import Path
  import time
  from kernel import Kernel
  from playwright.async_api import async_playwright

  kernel = Kernel()


  # Poll list_files until the expected file appears in the directory
  async def wait_for_file(
      session_id: str, file_path: str, timeout_sec: float = 30
  ):
      dir_path = str(Path(file_path).parent)
      filename = Path(file_path).name
      start = time.time()
      while time.time() - start < timeout_sec:
          files = kernel.browsers.fs.list_files(session_id, path=dir_path)
          if any(f.name == filename for f in files):
              return
          await asyncio.sleep(0.5)
      raise TimeoutError(f"File {file_path} not found after {timeout_sec}s")


  async def main():
      kernel_browser = kernel.browsers.create()
      print("Kernel browser live view url:", kernel_browser.browser_live_view_url)

      async with async_playwright() as playwright:
          browser = await playwright.chromium.connect_over_cdp(kernel_browser.cdp_ws_url)
          context = browser.contexts[0]
          page = context.pages[0] if len(context.pages) > 0 else await context.new_page()

          cdp_session = await context.new_cdp_session(page)
          await cdp_session.send(
              "Browser.setDownloadBehavior",
              {
                  "behavior": "default",
                  "eventsEnabled": True,
              },
          )

          download_completed = asyncio.Event()
          download_file_path: str | None = None
          download_state: str | None = None

          def _on_download_begin(event):
              print(f"Download started: {event.get('suggestedFilename', 'unknown')}")

          def _on_download_progress(event):
              nonlocal download_state, download_file_path
              if event.get("state") in ["completed", "canceled"]:
                  download_state = event.get("state")
                  download_file_path = event.get("filePath")
                  download_completed.set()

          cdp_session.on("Browser.downloadWillBegin", _on_download_begin)
          cdp_session.on("Browser.downloadProgress", _on_download_progress)

          print("Navigating to download test page")
          await page.goto("https://browser-tests-alpha.vercel.app/api/download-test")
          await page.get_by_role("link", name="Download File").click()

          try:
              await asyncio.wait_for(download_completed.wait(), timeout=10)
              print("Download completed")
          except asyncio.TimeoutError:
              print("Download timed out after 10 seconds")
              raise

          if download_state == "canceled":
              raise RuntimeError("Download was canceled")

          if not download_file_path:
              raise RuntimeError("Unable to determine download file path")

          # Wait for the file to be available via Kernel's File I/O APIs
          print(f"Waiting for file: {download_file_path}")
          await wait_for_file(kernel_browser.session_id, download_file_path)

          resp = kernel.browsers.fs.read_file(
              kernel_browser.session_id, path=download_file_path
          )
          local_path = f"./downloads/{Path(download_file_path).name}"
          os.makedirs("./downloads", exist_ok=True)
          resp.write_to_file(local_path)
          print(f"Saved to {local_path}")

          kernel.browsers.delete_by_id(kernel_browser.session_id)
          print("Kernel browser deleted successfully.")


  if __name__ == "__main__":
      asyncio.run(main())
  ```
</CodeGroup>

<Info>We recommend using the [list files](/api-reference/browsers/list-files-in-a-directory) API to poll for file availability before calling [read file](/api-reference/browsers/read-file-contents), as shown in the examples above. This approach ensures reliable downloads, especially for larger files. You can also use `listFiles` to enumerate and save all downloads at the end of a session.</Info>

### Stagehand v3

When using Stagehand with Kernel browsers, you need to configure the download behavior in the `localBrowserLaunchOptions`:

```typescript  theme={null}
const stagehand = new Stagehand({
  env: "LOCAL",
  verbose: 1,
  localBrowserLaunchOptions: {
    cdpUrl: kernelBrowser.cdp_ws_url,
    downloadsPath: DOWNLOAD_DIR, // Specify where downloads should be saved
    acceptDownloads: true, // Enable downloads
  },
});
```

Here's a complete example:

```typescript  theme={null}
import { Stagehand } from "@browserbasehq/stagehand";
import Kernel from "@onkernel/sdk";
import fs from "fs";

const DOWNLOAD_DIR = "/tmp/downloads";

// Poll listFiles until any file appears in the directory
async function waitForFile(
    kernel: Kernel,
    sessionId: string,
    dir: string,
    timeoutMs = 30_000
) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const files = await kernel.browsers.fs.listFiles(sessionId, { path: dir });
        if (files.length > 0) {
            return files[0];
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`No files found in ${dir} after ${timeoutMs}ms`);
}

async function main() {
    const kernel = new Kernel();

    console.log("Creating browser via Kernel...");
    const kernelBrowser = await kernel.browsers.create({
        stealth: true,
    });

    console.log(`Kernel Browser Session Started`);
    console.log(`Session ID: ${kernelBrowser.session_id}`);
    console.log(`Watch live: ${kernelBrowser.browser_live_view_url}`);

    // Initialize Stagehand with Kernel's CDP URL and download configuration
    const stagehand = new Stagehand({
        env: "LOCAL",
        verbose: 1,
        localBrowserLaunchOptions: {
            cdpUrl: kernelBrowser.cdp_ws_url,
            downloadsPath: DOWNLOAD_DIR,
            acceptDownloads: true,
        },
    });

    await stagehand.init();

    const page = stagehand.context.pages()[0];

    await page.goto("https://browser-tests-alpha.vercel.app/api/download-test");

    // Use Stagehand to click the download button
    await stagehand.act("Click the download file link");
    console.log("Download triggered");

    // Wait for the file to be fully available via Kernel's File I/O APIs
    console.log("Waiting for file to appear...");
    const downloadedFile = await waitForFile(
        kernel,
        kernelBrowser.session_id,
        DOWNLOAD_DIR
    );
    console.log(`File found: ${downloadedFile.name}`);

    const remotePath = `${DOWNLOAD_DIR}/${downloadedFile.name}`;
    console.log(`Reading file from: ${remotePath}`);

    // Read the file from Kernel browser's filesystem
    const resp = await kernel.browsers.fs.readFile(kernelBrowser.session_id, {
        path: remotePath,
    });

    // Save to local filesystem
    const bytes = await resp.bytes();
    fs.mkdirSync("downloads", { recursive: true });
    const localPath = `downloads/${downloadedFile.name}`;
    fs.writeFileSync(localPath, bytes);
    console.log(`Saved to ${localPath}`);

    // Clean up
    await stagehand.close();
    await kernel.browsers.deleteByID(kernelBrowser.session_id);
    console.log("Browser session closed");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
```

### Browser Use

Browser Use handles downloads automatically when configured properly. Documentation for Browser Use downloads coming soon.

## Uploads

Playwright's `setInputFiles()` method allows you to upload files directly to file input elements. You can fetch a file from a URL and pass the buffer directly to `setInputFiles()`.

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';
  import { chromium } from 'playwright';

  const IMAGE_URL = 'https://www.kernel.sh/brand_assets/Kernel-Logo_Accent.png';
  const kernel = new Kernel();

  async function main() {
      // Create Kernel browser session
      const kernelBrowser = await kernel.browsers.create();
      console.log('Live view:', kernelBrowser.browser_live_view_url);

      // Connect Playwright
      const browser = await chromium.connectOverCDP(kernelBrowser.cdp_ws_url);
      const context = browser.contexts()[0] || (await browser.newContext());
      const page = context.pages()[0] || (await context.newPage());

      // Navigate to a page with a file input
      await page.goto('https://browser-tests-alpha.vercel.app/api/upload-test');

      // Fetch file and pass buffer directly to setInputFiles
      const response = await fetch(IMAGE_URL);
      const buffer = Buffer.from(await response.arrayBuffer());

      await page.locator('input[type="file"]').setInputFiles([{
          name: 'Kernel-Logo_Accent.png',
          mimeType: 'image/png',
          buffer: buffer,
      }]);
      console.log('File uploaded');

      await kernel.browsers.deleteByID(kernelBrowser.session_id);
      console.log('Browser deleted');
  }

  main();
  ```

  ```python Python theme={null}
  import asyncio
  import httpx
  from kernel import Kernel
  from playwright.async_api import async_playwright

  IMAGE_URL = 'https://www.kernel.sh/brand_assets/Kernel-Logo_Accent.png'
  kernel = Kernel()


  async def main():
      # Create Kernel browser session
      kernel_browser = kernel.browsers.create()
      print(f'Live view: {kernel_browser.browser_live_view_url}')

      async with async_playwright() as playwright:
          # Connect Playwright
          browser = await playwright.chromium.connect_over_cdp(kernel_browser.cdp_ws_url)
          context = browser.contexts[0] if browser.contexts else await browser.new_context()
          page = context.pages[0] if context.pages else await context.new_page()

          # Navigate to a page with a file input
          await page.goto('https://browser-tests-alpha.vercel.app/api/upload-test')

          # Fetch file and pass buffer directly to set_input_files
          async with httpx.AsyncClient() as client:
              response = await client.get(IMAGE_URL)
              buffer = response.content

          await page.locator('input[type="file"]').set_input_files([{
              'name': 'Kernel-Logo_Accent.png',
              'mimeType': 'image/png',
              'buffer': buffer,
          }])
          print('File uploaded')

          await browser.close()

      kernel.browsers.delete_by_id(kernel_browser.session_id)
      print('Browser deleted')


  if __name__ == '__main__':
      asyncio.run(main())
  ```
</CodeGroup>
> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# File I/O

> Downloads, uploads, and manipulating the browser's filesystem

## Downloads

Kernel browsers run in fully sandboxed environments with writable filesystems. When your automation downloads a file, it's saved inside the browser's filesystem and can be retrieved using Kernel's File I/O APIs.

<Warning>
  Files can only be retrieved while the browser session is still active. Once the browser session is destroyed or times out, all files from that session are permanently deleted and no longer accessible.
</Warning>

### Playwright

Playwright performs downloads via the browser itself, so there are a few steps:

* Create a browser session
* Configure browser download behavior using CDP
* Perform the download
* Retrieve the file from the browser's filesystem

<Note>
  With `behavior: 'default'`, downloads are saved to the browser's default download directory. The CDP `downloadProgress` event includes a `filePath` field when the download completes, which tells you exactly where the file was saved. Use this path with Kernel's File I/O APIs to retrieve the file.
</Note>

<Info>
  The CDP `downloadProgress` event signals when the browser finishes writing a
  file, but there may be a brief delay before the file becomes available through
  Kernel's File I/O APIs. This is especially true for larger downloads. We
  recommend polling `listFiles` to confirm the file exists before attempting to
  read it.
</Info>

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';
  import { chromium } from 'playwright';
  import fs from 'fs';
  import path from 'path';
  import pTimeout from 'p-timeout';

  const kernel = new Kernel();

  // Poll listFiles until the expected file appears in the directory
  async function waitForFile(
    sessionId: string,
    filePath: string,
    timeoutMs = 30_000
  ) {
    const dir = path.dirname(filePath);
    const filename = path.basename(filePath);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const files = await kernel.browsers.fs.listFiles(sessionId, { path: dir });
      if (files.some((f) => f.name === filename)) {
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`File ${filePath} not found after ${timeoutMs}ms`);
  }

  async function main() {
    const kernelBrowser = await kernel.browsers.create();
    console.log('live view:', kernelBrowser.browser_live_view_url);

    const browser = await chromium.connectOverCDP(kernelBrowser.cdp_ws_url);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());

    const client = await context.newCDPSession(page);
    await client.send('Browser.setDownloadBehavior', {
      behavior: 'default',
      eventsEnabled: true,
    });

    // Set up CDP listeners to capture download path and completion
    let downloadFilePath: string | undefined;
    let downloadState: string | undefined;
    let downloadCompletedResolve!: () => void;
    const downloadCompleted = new Promise<void>((resolve) => {
      downloadCompletedResolve = resolve;
    });

    client.on('Browser.downloadWillBegin', (event) => {
      console.log('Download started:', event.suggestedFilename);
    });

    client.on('Browser.downloadProgress', (event) => {
      if (event.state === 'completed' || event.state === 'canceled') {
        downloadState = event.state;
        downloadFilePath = event.filePath;
        downloadCompletedResolve();
      }
    });

    console.log('Navigating to download test page');
    await page.goto('https://browser-tests-alpha.vercel.app/api/download-test');
    await page.getByRole('link', { name: 'Download File' }).click();

    try {
      await pTimeout(downloadCompleted, {
        milliseconds: 10_000,
        message: new Error('Download timed out after 10 seconds'),
      });
      console.log('Download completed');
    } catch (err) {
      console.error(err);
      throw err;
    }

    if (downloadState === 'canceled') {
      throw new Error('Download was canceled');
    }

    if (!downloadFilePath) {
      throw new Error('Unable to determine download file path');
    }

    // Wait for the file to be available via Kernel's File I/O APIs
    console.log(`Waiting for file: ${downloadFilePath}`);
    await waitForFile(kernelBrowser.session_id, downloadFilePath);

    console.log(`Reading file: ${downloadFilePath}`);

    const resp = await kernel.browsers.fs.readFile(kernelBrowser.session_id, {
      path: downloadFilePath,
    });

    const bytes = await resp.bytes();
    fs.mkdirSync('downloads', { recursive: true });
    const localPath = `downloads/${path.basename(downloadFilePath)}`;
    fs.writeFileSync(localPath, bytes);
    console.log(`Saved to ${localPath}`);

    await kernel.browsers.deleteByID(kernelBrowser.session_id);
    console.log('Kernel browser deleted successfully.');
  }

  main();

  ```

  ```python Python theme={null}
  import asyncio
  import os
  from pathlib import Path
  import time
  from kernel import Kernel
  from playwright.async_api import async_playwright

  kernel = Kernel()


  # Poll list_files until the expected file appears in the directory
  async def wait_for_file(
      session_id: str, file_path: str, timeout_sec: float = 30
  ):
      dir_path = str(Path(file_path).parent)
      filename = Path(file_path).name
      start = time.time()
      while time.time() - start < timeout_sec:
          files = kernel.browsers.fs.list_files(session_id, path=dir_path)
          if any(f.name == filename for f in files):
              return
          await asyncio.sleep(0.5)
      raise TimeoutError(f"File {file_path} not found after {timeout_sec}s")


  async def main():
      kernel_browser = kernel.browsers.create()
      print("Kernel browser live view url:", kernel_browser.browser_live_view_url)

      async with async_playwright() as playwright:
          browser = await playwright.chromium.connect_over_cdp(kernel_browser.cdp_ws_url)
          context = browser.contexts[0]
          page = context.pages[0] if len(context.pages) > 0 else await context.new_page()

          cdp_session = await context.new_cdp_session(page)
          await cdp_session.send(
              "Browser.setDownloadBehavior",
              {
                  "behavior": "default",
                  "eventsEnabled": True,
              },
          )

          download_completed = asyncio.Event()
          download_file_path: str | None = None
          download_state: str | None = None

          def _on_download_begin(event):
              print(f"Download started: {event.get('suggestedFilename', 'unknown')}")

          def _on_download_progress(event):
              nonlocal download_state, download_file_path
              if event.get("state") in ["completed", "canceled"]:
                  download_state = event.get("state")
                  download_file_path = event.get("filePath")
                  download_completed.set()

          cdp_session.on("Browser.downloadWillBegin", _on_download_begin)
          cdp_session.on("Browser.downloadProgress", _on_download_progress)

          print("Navigating to download test page")
          await page.goto("https://browser-tests-alpha.vercel.app/api/download-test")
          await page.get_by_role("link", name="Download File").click()

          try:
              await asyncio.wait_for(download_completed.wait(), timeout=10)
              print("Download completed")
          except asyncio.TimeoutError:
              print("Download timed out after 10 seconds")
              raise

          if download_state == "canceled":
              raise RuntimeError("Download was canceled")

          if not download_file_path:
              raise RuntimeError("Unable to determine download file path")

          # Wait for the file to be available via Kernel's File I/O APIs
          print(f"Waiting for file: {download_file_path}")
          await wait_for_file(kernel_browser.session_id, download_file_path)

          resp = kernel.browsers.fs.read_file(
              kernel_browser.session_id, path=download_file_path
          )
          local_path = f"./downloads/{Path(download_file_path).name}"
          os.makedirs("./downloads", exist_ok=True)
          resp.write_to_file(local_path)
          print(f"Saved to {local_path}")

          kernel.browsers.delete_by_id(kernel_browser.session_id)
          print("Kernel browser deleted successfully.")


  if __name__ == "__main__":
      asyncio.run(main())
  ```
</CodeGroup>

<Info>We recommend using the [list files](/api-reference/browsers/list-files-in-a-directory) API to poll for file availability before calling [read file](/api-reference/browsers/read-file-contents), as shown in the examples above. This approach ensures reliable downloads, especially for larger files. You can also use `listFiles` to enumerate and save all downloads at the end of a session.</Info>

### Stagehand v3

When using Stagehand with Kernel browsers, you need to configure the download behavior in the `localBrowserLaunchOptions`:

```typescript  theme={null}
const stagehand = new Stagehand({
  env: "LOCAL",
  verbose: 1,
  localBrowserLaunchOptions: {
    cdpUrl: kernelBrowser.cdp_ws_url,
    downloadsPath: DOWNLOAD_DIR, // Specify where downloads should be saved
    acceptDownloads: true, // Enable downloads
  },
});
```

Here's a complete example:

```typescript  theme={null}
import { Stagehand } from "@browserbasehq/stagehand";
import Kernel from "@onkernel/sdk";
import fs from "fs";

const DOWNLOAD_DIR = "/tmp/downloads";

// Poll listFiles until any file appears in the directory
async function waitForFile(
    kernel: Kernel,
    sessionId: string,
    dir: string,
    timeoutMs = 30_000
) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const files = await kernel.browsers.fs.listFiles(sessionId, { path: dir });
        if (files.length > 0) {
            return files[0];
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`No files found in ${dir} after ${timeoutMs}ms`);
}

async function main() {
    const kernel = new Kernel();

    console.log("Creating browser via Kernel...");
    const kernelBrowser = await kernel.browsers.create({
        stealth: true,
    });

    console.log(`Kernel Browser Session Started`);
    console.log(`Session ID: ${kernelBrowser.session_id}`);
    console.log(`Watch live: ${kernelBrowser.browser_live_view_url}`);

    // Initialize Stagehand with Kernel's CDP URL and download configuration
    const stagehand = new Stagehand({
        env: "LOCAL",
        verbose: 1,
        localBrowserLaunchOptions: {
            cdpUrl: kernelBrowser.cdp_ws_url,
            downloadsPath: DOWNLOAD_DIR,
            acceptDownloads: true,
        },
    });

    await stagehand.init();

    const page = stagehand.context.pages()[0];

    await page.goto("https://browser-tests-alpha.vercel.app/api/download-test");

    // Use Stagehand to click the download button
    await stagehand.act("Click the download file link");
    console.log("Download triggered");

    // Wait for the file to be fully available via Kernel's File I/O APIs
    console.log("Waiting for file to appear...");
    const downloadedFile = await waitForFile(
        kernel,
        kernelBrowser.session_id,
        DOWNLOAD_DIR
    );
    console.log(`File found: ${downloadedFile.name}`);

    const remotePath = `${DOWNLOAD_DIR}/${downloadedFile.name}`;
    console.log(`Reading file from: ${remotePath}`);

    // Read the file from Kernel browser's filesystem
    const resp = await kernel.browsers.fs.readFile(kernelBrowser.session_id, {
        path: remotePath,
    });

    // Save to local filesystem
    const bytes = await resp.bytes();
    fs.mkdirSync("downloads", { recursive: true });
    const localPath = `downloads/${downloadedFile.name}`;
    fs.writeFileSync(localPath, bytes);
    console.log(`Saved to ${localPath}`);

    // Clean up
    await stagehand.close();
    await kernel.browsers.deleteByID(kernelBrowser.session_id);
    console.log("Browser session closed");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
```

### Browser Use

Browser Use handles downloads automatically when configured properly. Documentation for Browser Use downloads coming soon.

## Uploads

Playwright's `setInputFiles()` method allows you to upload files directly to file input elements. You can fetch a file from a URL and pass the buffer directly to `setInputFiles()`.

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';
  import { chromium } from 'playwright';

  const IMAGE_URL = 'https://www.kernel.sh/brand_assets/Kernel-Logo_Accent.png';
  const kernel = new Kernel();

  async function main() {
      // Create Kernel browser session
      const kernelBrowser = await kernel.browsers.create();
      console.log('Live view:', kernelBrowser.browser_live_view_url);

      // Connect Playwright
      const browser = await chromium.connectOverCDP(kernelBrowser.cdp_ws_url);
      const context = browser.contexts()[0] || (await browser.newContext());
      const page = context.pages()[0] || (await context.newPage());

      // Navigate to a page with a file input
      await page.goto('https://browser-tests-alpha.vercel.app/api/upload-test');

      // Fetch file and pass buffer directly to setInputFiles
      const response = await fetch(IMAGE_URL);
      const buffer = Buffer.from(await response.arrayBuffer());

      await page.locator('input[type="file"]').setInputFiles([{
          name: 'Kernel-Logo_Accent.png',
          mimeType: 'image/png',
          buffer: buffer,
      }]);
      console.log('File uploaded');

      await kernel.browsers.deleteByID(kernelBrowser.session_id);
      console.log('Browser deleted');
  }

  main();
  ```

  ```python Python theme={null}
  import asyncio
  import httpx
  from kernel import Kernel
  from playwright.async_api import async_playwright

  IMAGE_URL = 'https://www.kernel.sh/brand_assets/Kernel-Logo_Accent.png'
  kernel = Kernel()


  async def main():
      # Create Kernel browser session
      kernel_browser = kernel.browsers.create()
      print(f'Live view: {kernel_browser.browser_live_view_url}')

      async with async_playwright() as playwright:
          # Connect Playwright
          browser = await playwright.chromium.connect_over_cdp(kernel_browser.cdp_ws_url)
          context = browser.contexts[0] if browser.contexts else await browser.new_context()
          page = context.pages[0] if context.pages else await context.new_page()

          # Navigate to a page with a file input
          await page.goto('https://browser-tests-alpha.vercel.app/api/upload-test')

          # Fetch file and pass buffer directly to set_input_files
          async with httpx.AsyncClient() as client:
              response = await client.get(IMAGE_URL)
              buffer = response.content

          await page.locator('input[type="file"]').set_input_files([{
              'name': 'Kernel-Logo_Accent.png',
              'mimeType': 'image/png',
              'buffer': buffer,
          }])
          print('File uploaded')

          await browser.close()

      kernel.browsers.delete_by_id(kernel_browser.session_id)
      print('Browser deleted')


  if __name__ == '__main__':
      asyncio.run(main())
  ```
</CodeGroup>
> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# File I/O

> Downloads, uploads, and manipulating the browser's filesystem

## Downloads

Kernel browsers run in fully sandboxed environments with writable filesystems. When your automation downloads a file, it's saved inside the browser's filesystem and can be retrieved using Kernel's File I/O APIs.

<Warning>
  Files can only be retrieved while the browser session is still active. Once the browser session is destroyed or times out, all files from that session are permanently deleted and no longer accessible.
</Warning>

### Playwright

Playwright performs downloads via the browser itself, so there are a few steps:

* Create a browser session
* Configure browser download behavior using CDP
* Perform the download
* Retrieve the file from the browser's filesystem

<Note>
  With `behavior: 'default'`, downloads are saved to the browser's default download directory. The CDP `downloadProgress` event includes a `filePath` field when the download completes, which tells you exactly where the file was saved. Use this path with Kernel's File I/O APIs to retrieve the file.
</Note>

<Info>
  The CDP `downloadProgress` event signals when the browser finishes writing a
  file, but there may be a brief delay before the file becomes available through
  Kernel's File I/O APIs. This is especially true for larger downloads. We
  recommend polling `listFiles` to confirm the file exists before attempting to
  read it.
</Info>

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';
  import { chromium } from 'playwright';
  import fs from 'fs';
  import path from 'path';
  import pTimeout from 'p-timeout';

  const kernel = new Kernel();

  // Poll listFiles until the expected file appears in the directory
  async function waitForFile(
    sessionId: string,
    filePath: string,
    timeoutMs = 30_000
  ) {
    const dir = path.dirname(filePath);
    const filename = path.basename(filePath);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const files = await kernel.browsers.fs.listFiles(sessionId, { path: dir });
      if (files.some((f) => f.name === filename)) {
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`File ${filePath} not found after ${timeoutMs}ms`);
  }

  async function main() {
    const kernelBrowser = await kernel.browsers.create();
    console.log('live view:', kernelBrowser.browser_live_view_url);

    const browser = await chromium.connectOverCDP(kernelBrowser.cdp_ws_url);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());

    const client = await context.newCDPSession(page);
    await client.send('Browser.setDownloadBehavior', {
      behavior: 'default',
      eventsEnabled: true,
    });

    // Set up CDP listeners to capture download path and completion
    let downloadFilePath: string | undefined;
    let downloadState: string | undefined;
    let downloadCompletedResolve!: () => void;
    const downloadCompleted = new Promise<void>((resolve) => {
      downloadCompletedResolve = resolve;
    });

    client.on('Browser.downloadWillBegin', (event) => {
      console.log('Download started:', event.suggestedFilename);
    });

    client.on('Browser.downloadProgress', (event) => {
      if (event.state === 'completed' || event.state === 'canceled') {
        downloadState = event.state;
        downloadFilePath = event.filePath;
        downloadCompletedResolve();
      }
    });

    console.log('Navigating to download test page');
    await page.goto('https://browser-tests-alpha.vercel.app/api/download-test');
    await page.getByRole('link', { name: 'Download File' }).click();

    try {
      await pTimeout(downloadCompleted, {
        milliseconds: 10_000,
        message: new Error('Download timed out after 10 seconds'),
      });
      console.log('Download completed');
    } catch (err) {
      console.error(err);
      throw err;
    }

    if (downloadState === 'canceled') {
      throw new Error('Download was canceled');
    }

    if (!downloadFilePath) {
      throw new Error('Unable to determine download file path');
    }

    // Wait for the file to be available via Kernel's File I/O APIs
    console.log(`Waiting for file: ${downloadFilePath}`);
    await waitForFile(kernelBrowser.session_id, downloadFilePath);

    console.log(`Reading file: ${downloadFilePath}`);

    const resp = await kernel.browsers.fs.readFile(kernelBrowser.session_id, {
      path: downloadFilePath,
    });

    const bytes = await resp.bytes();
    fs.mkdirSync('downloads', { recursive: true });
    const localPath = `downloads/${path.basename(downloadFilePath)}`;
    fs.writeFileSync(localPath, bytes);
    console.log(`Saved to ${localPath}`);

    await kernel.browsers.deleteByID(kernelBrowser.session_id);
    console.log('Kernel browser deleted successfully.');
  }

  main();

  ```

  ```python Python theme={null}
  import asyncio
  import os
  from pathlib import Path
  import time
  from kernel import Kernel
  from playwright.async_api import async_playwright

  kernel = Kernel()


  # Poll list_files until the expected file appears in the directory
  async def wait_for_file(
      session_id: str, file_path: str, timeout_sec: float = 30
  ):
      dir_path = str(Path(file_path).parent)
      filename = Path(file_path).name
      start = time.time()
      while time.time() - start < timeout_sec:
          files = kernel.browsers.fs.list_files(session_id, path=dir_path)
          if any(f.name == filename for f in files):
              return
          await asyncio.sleep(0.5)
      raise TimeoutError(f"File {file_path} not found after {timeout_sec}s")


  async def main():
      kernel_browser = kernel.browsers.create()
      print("Kernel browser live view url:", kernel_browser.browser_live_view_url)

      async with async_playwright() as playwright:
          browser = await playwright.chromium.connect_over_cdp(kernel_browser.cdp_ws_url)
          context = browser.contexts[0]
          page = context.pages[0] if len(context.pages) > 0 else await context.new_page()

          cdp_session = await context.new_cdp_session(page)
          await cdp_session.send(
              "Browser.setDownloadBehavior",
              {
                  "behavior": "default",
                  "eventsEnabled": True,
              },
          )

          download_completed = asyncio.Event()
          download_file_path: str | None = None
          download_state: str | None = None

          def _on_download_begin(event):
              print(f"Download started: {event.get('suggestedFilename', 'unknown')}")

          def _on_download_progress(event):
              nonlocal download_state, download_file_path
              if event.get("state") in ["completed", "canceled"]:
                  download_state = event.get("state")
                  download_file_path = event.get("filePath")
                  download_completed.set()

          cdp_session.on("Browser.downloadWillBegin", _on_download_begin)
          cdp_session.on("Browser.downloadProgress", _on_download_progress)

          print("Navigating to download test page")
          await page.goto("https://browser-tests-alpha.vercel.app/api/download-test")
          await page.get_by_role("link", name="Download File").click()

          try:
              await asyncio.wait_for(download_completed.wait(), timeout=10)
              print("Download completed")
          except asyncio.TimeoutError:
              print("Download timed out after 10 seconds")
              raise

          if download_state == "canceled":
              raise RuntimeError("Download was canceled")

          if not download_file_path:
              raise RuntimeError("Unable to determine download file path")

          # Wait for the file to be available via Kernel's File I/O APIs
          print(f"Waiting for file: {download_file_path}")
          await wait_for_file(kernel_browser.session_id, download_file_path)

          resp = kernel.browsers.fs.read_file(
              kernel_browser.session_id, path=download_file_path
          )
          local_path = f"./downloads/{Path(download_file_path).name}"
          os.makedirs("./downloads", exist_ok=True)
          resp.write_to_file(local_path)
          print(f"Saved to {local_path}")

          kernel.browsers.delete_by_id(kernel_browser.session_id)
          print("Kernel browser deleted successfully.")


  if __name__ == "__main__":
      asyncio.run(main())
  ```
</CodeGroup>

<Info>We recommend using the [list files](/api-reference/browsers/list-files-in-a-directory) API to poll for file availability before calling [read file](/api-reference/browsers/read-file-contents), as shown in the examples above. This approach ensures reliable downloads, especially for larger files. You can also use `listFiles` to enumerate and save all downloads at the end of a session.</Info>

### Stagehand v3

When using Stagehand with Kernel browsers, you need to configure the download behavior in the `localBrowserLaunchOptions`:

```typescript  theme={null}
const stagehand = new Stagehand({
  env: "LOCAL",
  verbose: 1,
  localBrowserLaunchOptions: {
    cdpUrl: kernelBrowser.cdp_ws_url,
    downloadsPath: DOWNLOAD_DIR, // Specify where downloads should be saved
    acceptDownloads: true, // Enable downloads
  },
});
```

Here's a complete example:

```typescript  theme={null}
import { Stagehand } from "@browserbasehq/stagehand";
import Kernel from "@onkernel/sdk";
import fs from "fs";

const DOWNLOAD_DIR = "/tmp/downloads";

// Poll listFiles until any file appears in the directory
async function waitForFile(
    kernel: Kernel,
    sessionId: string,
    dir: string,
    timeoutMs = 30_000
) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const files = await kernel.browsers.fs.listFiles(sessionId, { path: dir });
        if (files.length > 0) {
            return files[0];
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`No files found in ${dir} after ${timeoutMs}ms`);
}

async function main() {
    const kernel = new Kernel();

    console.log("Creating browser via Kernel...");
    const kernelBrowser = await kernel.browsers.create({
        stealth: true,
    });

    console.log(`Kernel Browser Session Started`);
    console.log(`Session ID: ${kernelBrowser.session_id}`);
    console.log(`Watch live: ${kernelBrowser.browser_live_view_url}`);

    // Initialize Stagehand with Kernel's CDP URL and download configuration
    const stagehand = new Stagehand({
        env: "LOCAL",
        verbose: 1,
        localBrowserLaunchOptions: {
            cdpUrl: kernelBrowser.cdp_ws_url,
            downloadsPath: DOWNLOAD_DIR,
            acceptDownloads: true,
        },
    });

    await stagehand.init();

    const page = stagehand.context.pages()[0];

    await page.goto("https://browser-tests-alpha.vercel.app/api/download-test");

    // Use Stagehand to click the download button
    await stagehand.act("Click the download file link");
    console.log("Download triggered");

    // Wait for the file to be fully available via Kernel's File I/O APIs
    console.log("Waiting for file to appear...");
    const downloadedFile = await waitForFile(
        kernel,
        kernelBrowser.session_id,
        DOWNLOAD_DIR
    );
    console.log(`File found: ${downloadedFile.name}`);

    const remotePath = `${DOWNLOAD_DIR}/${downloadedFile.name}`;
    console.log(`Reading file from: ${remotePath}`);

    // Read the file from Kernel browser's filesystem
    const resp = await kernel.browsers.fs.readFile(kernelBrowser.session_id, {
        path: remotePath,
    });

    // Save to local filesystem
    const bytes = await resp.bytes();
    fs.mkdirSync("downloads", { recursive: true });
    const localPath = `downloads/${downloadedFile.name}`;
    fs.writeFileSync(localPath, bytes);
    console.log(`Saved to ${localPath}`);

    // Clean up
    await stagehand.close();
    await kernel.browsers.deleteByID(kernelBrowser.session_id);
    console.log("Browser session closed");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
```

### Browser Use

Browser Use handles downloads automatically when configured properly. Documentation for Browser Use downloads coming soon.

## Uploads

Playwright's `setInputFiles()` method allows you to upload files directly to file input elements. You can fetch a file from a URL and pass the buffer directly to `setInputFiles()`.

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';
  import { chromium } from 'playwright';

  const IMAGE_URL = 'https://www.kernel.sh/brand_assets/Kernel-Logo_Accent.png';
  const kernel = new Kernel();

  async function main() {
      // Create Kernel browser session
      const kernelBrowser = await kernel.browsers.create();
      console.log('Live view:', kernelBrowser.browser_live_view_url);

      // Connect Playwright
      const browser = await chromium.connectOverCDP(kernelBrowser.cdp_ws_url);
      const context = browser.contexts()[0] || (await browser.newContext());
      const page = context.pages()[0] || (await context.newPage());

      // Navigate to a page with a file input
      await page.goto('https://browser-tests-alpha.vercel.app/api/upload-test');

      // Fetch file and pass buffer directly to setInputFiles
      const response = await fetch(IMAGE_URL);
      const buffer = Buffer.from(await response.arrayBuffer());

      await page.locator('input[type="file"]').setInputFiles([{
          name: 'Kernel-Logo_Accent.png',
          mimeType: 'image/png',
          buffer: buffer,
      }]);
      console.log('File uploaded');

      await kernel.browsers.deleteByID(kernelBrowser.session_id);
      console.log('Browser deleted');
  }

  main();
  ```

  ```python Python theme={null}
  import asyncio
  import httpx
  from kernel import Kernel
  from playwright.async_api import async_playwright

  IMAGE_URL = 'https://www.kernel.sh/brand_assets/Kernel-Logo_Accent.png'
  kernel = Kernel()


  async def main():
      # Create Kernel browser session
      kernel_browser = kernel.browsers.create()
      print(f'Live view: {kernel_browser.browser_live_view_url}')

      async with async_playwright() as playwright:
          # Connect Playwright
          browser = await playwright.chromium.connect_over_cdp(kernel_browser.cdp_ws_url)
          context = browser.contexts[0] if browser.contexts else await browser.new_context()
          page = context.pages[0] if context.pages else await context.new_page()

          # Navigate to a page with a file input
          await page.goto('https://browser-tests-alpha.vercel.app/api/upload-test')

          # Fetch file and pass buffer directly to set_input_files
          async with httpx.AsyncClient() as client:
              response = await client.get(IMAGE_URL)
              buffer = response.content

          await page.locator('input[type="file"]').set_input_files([{
              'name': 'Kernel-Logo_Accent.png',
              'mimeType': 'image/png',
              'buffer': buffer,
          }])
          print('File uploaded')

          await browser.close()

      kernel.browsers.delete_by_id(kernel_browser.session_id)
      print('Browser deleted')


  if __name__ == '__main__':
      asyncio.run(main())
  ```
</CodeGroup>
> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# SSH Access

> Open an interactive SSH session to a browser VM

SSH into a running Kernel browser VM for debugging, running commands, or setting up port forwarding.

## Forward local dev server to browser

A common use case is exposing a local development server to the remote Kernel browser. This lets the browser access `localhost` URLs that point to your local machine:

```bash  theme={null}
# 1. Start your local dev server (e.g., on port 3000)
npm run dev

# 2. Create a browser with extended timeout
kernel browsers create --timeout 600

# 3. Forward your local server to the VM
#    This exposes localhost:3000 on your machine as localhost:3000 inside the VM
kernel browsers ssh <session-id> -R 3000:localhost:3000

# 4. In the browser's live view, navigate to:
#    http://localhost:3000
```

<Note>
  Kernel detects browser activity via WebRTC (live view) or CDP connections. SSH connections alone don't count as activity, so without `--timeout`, your browser may be cleaned up while you're connected via SSH. Either set a timeout or keep the [live view](/browsers/live-view) open.
</Note>

## Prerequisites

The `kernel browsers ssh` command requires [websocat](https://github.com/vi/websocat) to be installed locally:

<Tabs>
  <Tab title="macOS">
    ```bash  theme={null}
    brew install websocat
    ```
  </Tab>

  <Tab title="Linux">
    ```bash  theme={null}
    curl -fsSL https://github.com/vi/websocat/releases/download/v1.14.1/websocat.x86_64-unknown-linux-musl \
      -o /usr/local/bin/websocat && chmod +x /usr/local/bin/websocat
    ```
  </Tab>
</Tabs>

## Basic usage

Open an interactive SSH shell to a browser VM:

```bash  theme={null}
kernel browsers ssh <session-id>
```

By default, this generates an ephemeral ed25519 SSH keypair for the session. The keypair is automatically cleaned up when the session ends.

## Using an existing SSH key

Specify an existing SSH private key instead of generating an ephemeral one:

```bash  theme={null}
kernel browsers ssh <session-id> -i ~/.ssh/id_ed25519
```

<Note>
  The corresponding `.pub` file must exist alongside the private key (e.g., `~/.ssh/id_ed25519.pub`).
</Note>

## Port forwarding

Port forwarding uses standard SSH syntax.

### Local forwarding (`-L`)

Forward a local port to a port on the VM. Useful for accessing services running inside the VM from your local machine:

```bash  theme={null}
# Access VM's port 5432 (e.g., a database) on local port 5432
kernel browsers ssh <session-id> -L 5432:localhost:5432
```

### Remote forwarding (`-R`)

Forward a VM port to a port on your local machine. Useful for exposing a local development server to the browser:

```bash  theme={null}
# Expose local dev server (port 3000) on VM port 8080
kernel browsers ssh <session-id> -R 8080:localhost:3000
```

This allows code running in the browser to access `localhost:8080` and reach your local development server.

## Setup only

Configure SSH on the VM without opening a connection:

```bash  theme={null}
kernel browsers ssh <session-id> --setup-only
```

This installs and configures the SSH server on the VM, then prints the manual connection command. Useful if you want to connect with your own SSH client or configuration.

## Flags

| Flag                          | Description                                                    |
| ----------------------------- | -------------------------------------------------------------- |
| `-i, --identity <path>`       | Path to SSH private key (generates ephemeral if not provided). |
| `-L, --local-forward <spec>`  | Local port forwarding (`localport:host:remoteport`).           |
| `-R, --remote-forward <spec>` | Remote port forwarding (`remoteport:host:localport`).          |
| `--setup-only`                | Setup SSH on VM without connecting.                            |
> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Computer Controls

> Control the computer's mouse, keyboard, and screen

Use OS-level controls to move and click the mouse, type and press keys, scroll, drag, and capture screenshots from a running browser session.

<Info>
  Computer control actions are only available for browsers created after October 15, 2025. Older browser instances do not support these features.
</Info>

## Click the mouse

Simulate mouse clicks at specific coordinates. You can select the button, click type (down, up, click), number of clicks, and optional modifier keys to hold.

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';

  const kernel = new Kernel();
  const kernelBrowser = await kernel.browsers.create();

  // Basic left click at (100, 200)
  await kernel.browsers.computer.clickMouse(kernelBrowser.session_id, {
    x: 100,
    y: 200,
  });

  // Double right-click while holding Shift
  await kernel.browsers.computer.clickMouse(kernelBrowser.session_id, {
    x: 100,
    y: 200,
    button: 'right',
    click_type: 'click',
    num_clicks: 2,
    hold_keys: ['Shift'],
  });
  ```

  ```python Python theme={null}
  from kernel import Kernel

  kernel = Kernel()
  kernel_browser = kernel.browsers.create()

  # Basic left click at (100, 200)
  kernel.browsers.computer.click_mouse(
      id=kernel_browser.session_id,
      x=100,
      y=200,
  )

  # Double right-click while holding Shift
  kernel.browsers.computer.click_mouse(
      id=kernel_browser.session_id,
      x=100,
      y=200,
      button="right",
      click_type="click",
      num_clicks=2,
      hold_keys=["Shift"],
  )
  ```

  ```bash CLI theme={null}
  # Click the mouse at coordinates (100, 200)
  kernel browsers computer click-mouse <session id> --x 100 --y 200

  # Double-click the right mouse button
  kernel browsers computer click-mouse <session id> --x 100 --y 200 --num-clicks 2 --button right
  ```
</CodeGroup>

## Move the mouse

Move the cursor to specific screen coordinates. Optionally hold modifier keys during the move.

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';

  const kernel = new Kernel();
  const kernelBrowser = await kernel.browsers.create();

  await kernel.browsers.computer.moveMouse(kernelBrowser.session_id, {
    x: 500,
    y: 300,
    hold_keys: ['Alt'],
  });
  ```

  ```python Python theme={null}
  from kernel import Kernel

  kernel = Kernel()
  kernel_browser = kernel.browsers.create()

  kernel.browsers.computer.move_mouse(
      id=kernel_browser.session_id,
      x=500,
      y=300,
      hold_keys=["Alt"],
  )
  ```

  ```bash CLI theme={null}
  # Move the mouse to coordinates (500, 300)
  kernel browsers computer move-mouse <session id> --x 500 --y 300
  ```
</CodeGroup>

## Take screenshots

Capture a full-screen PNG or a specific region.

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import fs from 'fs';
  import { Buffer } from 'buffer';
  import Kernel from '@onkernel/sdk';

  const kernel = new Kernel();
  const kernelBrowser = await kernel.browsers.create();

  // Full screenshot
  {
    const response = await kernel.browsers.computer.captureScreenshot(kernelBrowser.session_id);
    const blob = await response.blob();
    const buffer = Buffer.from(await blob.arrayBuffer());
    fs.writeFileSync('screenshot.png', buffer);
  }

  // Region screenshot
  {
    const response = await kernel.browsers.computer.captureScreenshot(kernelBrowser.session_id, {
      region: { x: 0, y: 0, width: 800, height: 600 },
    });
    const blob = await response.blob();
    const buffer = Buffer.from(await blob.arrayBuffer());
    fs.writeFileSync('region.png', buffer);
  }
  ```

  ```python Python theme={null}
  from kernel import Kernel

  kernel = Kernel()
  kernel_browser = kernel.browsers.create()

  # Full screenshot
  with open('screenshot.png', 'wb') as f:
      image_data = kernel.browsers.computer.capture_screenshot(id=kernel_browser.session_id)
      f.write(image_data.read())

  # Region screenshot
  with open('region.png', 'wb') as f:
      image_data = kernel.browsers.computer.capture_screenshot(
          id=kernel_browser.session_id,
          region={"x": 0, "y": 0, "width": 800, "height": 600},
      )
      f.write(image_data.read())
  ```

  ```bash CLI theme={null}
  # Take a full screenshot
  kernel browsers computer screenshot <session id> --to screenshot.png

  # Take a screenshot of a specific region
  kernel browsers computer screenshot <session id> --to region.png --x 0 --y 0 --width 800 --height 600
  ```
</CodeGroup>

## Type text

Type literal text, optionally with a delay in milliseconds between keystrokes.

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';

  const kernel = new Kernel();
  const kernelBrowser = await kernel.browsers.create();

  await kernel.browsers.computer.typeText(kernelBrowser.session_id, {
    text: 'Hello, World!',
  });

  await kernel.browsers.computer.typeText(kernelBrowser.session_id, {
    text: 'Slow typing...',
    delay: 100,
  });
  ```

  ```python Python theme={null}
  from kernel import Kernel

  kernel = Kernel()
  kernel_browser = kernel.browsers.create()

  kernel.browsers.computer.type_text(
      id=kernel_browser.session_id,
      text="Hello, World!",
  )

  kernel.browsers.computer.type_text(
      id=kernel_browser.session_id,
      text="Slow typing...",
      delay=100,
  )
  ```

  ```bash CLI theme={null}
  # Type text in the browser
  kernel browsers computer type <session id> --text "Hello, World!"

  # Type text with a 100ms delay between keystrokes
  kernel browsers computer type <session id> --text "Slow typing..." --delay 100
  ```
</CodeGroup>

## Press keys

Press one or more key symbols (including combinations like "Ctrl+t" or "Ctrl+Shift+Tab"). Optionally hold modifiers and/or set a duration to hold keys down.

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';

  const kernel = new Kernel();
  const kernelBrowser = await kernel.browsers.create();

  // Tap a key combination
  await kernel.browsers.computer.pressKey(kernelBrowser.session_id, {
    keys: ['Ctrl+t'],
  });

  // Hold keys for 250ms while also holding Alt
  await kernel.browsers.computer.pressKey(kernelBrowser.session_id, {
    keys: ['Ctrl+Shift+Tab'],
    duration: 250,
    hold_keys: ['Alt'],
  });
  ```

  ```python Python theme={null}
  from kernel import Kernel

  kernel = Kernel()
  kernel_browser = kernel.browsers.create()

  # Tap a key combination
  kernel.browsers.computer.press_key(
      id=kernel_browser.session_id,
      keys=["Ctrl+t"],
  )

  # Hold keys for 250ms while also holding Alt
  kernel.browsers.computer.press_key(
      id=kernel_browser.session_id,
      keys=["Ctrl+Shift+Tab"],
      duration=250,
      hold_keys=["Alt"],
  )
  ```

  ```bash CLI theme={null}
  # Press one or more keys (repeatable --key)
  kernel browsers computer press-key <session id> --key Ctrl+t

  # Hold for a duration and add optional modifiers
  kernel browsers computer press-key <session id> --key Ctrl+Shift+Tab --duration 250 --hold-key Alt
  ```
</CodeGroup>

## Scroll

Scroll the mouse wheel at a specific position. Positive `delta_y` scrolls down; negative scrolls up. Positive `delta_x` scrolls right; negative scrolls left.

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';

  const kernel = new Kernel();
  const kernelBrowser = await kernel.browsers.create();

  await kernel.browsers.computer.scroll(kernelBrowser.session_id, {
    x: 300,
    y: 400,
    delta_x: 0,
    delta_y: 120,
  });
  ```

  ```python Python theme={null}
  from kernel import Kernel

  kernel = Kernel()
  kernel_browser = kernel.browsers.create()

  kernel.browsers.computer.scroll(
      id=kernel_browser.session_id,
      x=300,
      y=400,
      delta_x=0,
      delta_y=120,
  )
  ```

  ```bash CLI theme={null}
  # Scroll at a position
  kernel browsers computer scroll <session id> --x 300 --y 400 --delta-y 120
  ```
</CodeGroup>

## Drag the mouse

Drag by pressing a button, moving along a path of points, then releasing. You can control delay before starting, the granularity and speed of the drag via `steps_per_segment` and `step_delay_ms`, and optionally hold modifier keys.

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';

  const kernel = new Kernel();
  const kernelBrowser = await kernel.browsers.create();

  await kernel.browsers.computer.dragMouse(kernelBrowser.session_id, {
    path: [
      [100, 200],
      [150, 220],
      [200, 260],
    ],
    button: 'left',
    delay: 0,
    steps_per_segment: 10,
    step_delay_ms: 50,
    hold_keys: ['Shift'],
  });
  ```

  ```python Python theme={null}
  from kernel import Kernel

  kernel = Kernel()
  kernel_browser = kernel.browsers.create()

  kernel.browsers.computer.drag_mouse(
      id=kernel_browser.session_id,
      path=[[100, 200], [150, 220], [200, 260]],
      button="left",
      delay=0,
      steps_per_segment=10,
      step_delay_ms=50,
      hold_keys=["Shift"],
  )
  ```

  ```bash CLI theme={null}
  # Drag the mouse along a path
  kernel browsers computer drag-mouse <session id> \
    --point 100,200 \
    --point 150,220 \
    --point 200,260 \
    --button left \
    --delay 0
  ```
</CodeGroup>
> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Playwright Execution

> Execute Playwright code in the same VM as your browser

Execute arbitrary Playwright/TypeScript code in a fresh execution context against your browser. The code runs in the same VM as the browser, minimizing latency and maximizing throughput.

**For complex workloads, Kernel has a full [code execution platform](/apps)**.

## How it works

When you execute Playwright code through this API:

* Your code runs directly in the browser's VM (no CDP overhead)
* You have access to `page`, `context`, and `browser` variables
* You can `return` a value, which is returned in the response
* Execution is isolated in a fresh context each time

## Quick example

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel from '@onkernel/sdk';

  const kernel = new Kernel();

  // Create a browser
  const kernelBrowser = await kernel.browsers.create();

  // Execute Playwright code
  const response = await kernel.browsers.playwright.execute(
    kernelBrowser.session_id,
    {
      code: `
        await page.goto('https://example.com');
        return await page.title();
      `
    }
  );

  console.log(response.result); // "Example Domain"
  ```

  ```python Python theme={null}
  from kernel import Kernel

  kernel = Kernel()

  # Create a browser
  kernel_browser = kernel.browsers.create()

  # Execute Playwright code
  response = kernel.browsers.playwright.execute(
      id=kernel_browser.session_id,
      code="""
          await page.goto('https://example.com')
          return await page.title()
      """
  )

  print(response.result)  # "Example Domain"
  ```

  ```bash CLI theme={null}
  kernel browsers playwright execute <session_id> 'await page.goto("https://www.onkernel.com"); return page.title();'
  ```
</CodeGroup>

## Available variables

Your code has access to these Playwright objects:

* `page` - The current page instance
* `context` - The browser context
* `browser` - The browser instance

## Returning values

Use a `return` statement to send data back from your code:

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  const response = await kernel.browsers.playwright.execute(
    sessionId,
    {
      code: `
        await page.goto('https://example.com');
        const title = await page.title();
        const url = page.url();
        return { title, url };
      `
    }
  );

  console.log(response.result); // { title: "Example Domain", url: "https://example.com" }
  ```

  ```python Python theme={null}
  response = kernel.browsers.playwright.execute(
      id=session_id,
      code="""
          await page.goto('https://example.com')
          title = await page.title()
          url = page.url()
          return {'title': title, 'url': url}
      """
  )

  print(response.result)  # {'title': 'Example Domain', 'url': 'https://example.com'}
  ```
</CodeGroup>

## Timeout configuration

Set a custom timeout (default is 60 seconds, max is 300 seconds):

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  const response = await kernel.browsers.playwright.execute(
    sessionId,
    {
      code: `
        await page.goto('https://example.com');
        return await page.title();
      `,
      timeout_sec: 120
    }
  );
  ```

  ```python Python theme={null}
  response = kernel.browsers.playwright.execute(
      id=session_id,
      code="""
          await page.goto('https://example.com')
          return await page.title()
      """,
      timeout_sec=120
  )
  ```
</CodeGroup>

## Error handling

The response includes error information if execution fails:

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  const response = await kernel.browsers.playwright.execute(
    sessionId,
    {
      code: `
        await page.goto('https://invalid-url');
        return await page.title();
      `
    }
  );

  if (!response.success) {
    console.error('Error:', response.error);
    console.error('Stderr:', response.stderr);
  }
  ```

  ```python Python theme={null}
  response = kernel.browsers.playwright.execute(
      id=session_id,
      code="""
          await page.goto('https://invalid-url')
          return await page.title()
      """
  )

  if not response.success:
      print('Error:', response.error)
      print('Stderr:', response.stderr)
  ```
</CodeGroup>

## Use cases

### Web scraping

Extract data from multiple pages without CDP overhead:

```typescript  theme={null}
const response = await kernel.browsers.playwright.execute(
  sessionId,
  {
    code: `
      await page.goto('https://news.ycombinator.com');
      const titles = await page.$$eval('.titleline > a', 
        links => links.map(link => link.textContent)
      );
      return titles.slice(0, 10);
    `
  }
);
```

### Form automation

Fill and submit forms quickly:

```typescript  theme={null}
const response = await kernel.browsers.playwright.execute(
  sessionId,
  {
    code: `
      await page.goto('https://example.com/form');
      await page.fill('#email', 'user@example.com');
      await page.fill('#password', 'password123');
      await page.click('button[type="submit"]');
      await page.waitForNavigation();
      return page.url();
    `
  }
);
```

### Testing and validation

Run quick checks against your browser state:

```typescript  theme={null}
const response = await kernel.browsers.playwright.execute(
  sessionId,
  {
    code: `
      const cookies = await context.cookies();
      const localStorage = await page.evaluate(() => 
        JSON.stringify(window.localStorage)
      );
      return { cookies, localStorage };
    `
  }
);
```

### Screenshots

Capture screenshots using Playwright's native screenshot API:

```typescript  theme={null}
const response = await kernel.browsers.playwright.execute(
  sessionId,
  {
    code: `
      await page.goto('https://example.com');
      const screenshot = await page.screenshot({ 
        type: 'png',
        fullPage: true 
      });
      return screenshot.toString('base64');
    `
  }
);

// Decode and save the screenshot
const buffer = Buffer.from(response.result, 'base64');
fs.writeFileSync('screenshot.png', buffer);
```

<Note>
  For OS-level screenshots using coordinates and regions, see [Computer Controls](/browsers/computer-controls#take-screenshots).
</Note>

## Performance benefits

Compared to connecting over CDP:

* **Lower latency** - Code runs in the same VM as the browser
* **Higher throughput** - No websocket overhead for commands
* **Simpler code** - No need to manage CDP connections

This makes it ideal for one-off operations where you need maximum speed.

## MCP server integration

This feature is available as a tool in our [MCP server](/reference/mcp-server). AI agents can use the `execute_playwright_code` tool to run Playwright code against browsers with automatic video replay and cleanup.
> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Developing

In addition to our browser API, Kernel provides a code execution platform for deploying and invoking code. Typically, Kernel's code execution platform is used for deploying and invoking browser automations or web agents.

When using Kernel's code execution platform, we co-locate your code with any Kernel browser environments you instantiate in your app. This solves common issues with browser connections over CDP:

* **Reduced latency:** Your code runs directly alongside the browser, reducing round-trip latency
* **Improved reliability:** Fewer unexpected disconnects between your code and browser
* **Higher throughput:** Eliminates bandwidth bottlenecks during data-intensive operations like screenshots

<Tip>
  Install our [MCP server](/reference/mcp-server) to give your coding agent our `search_docs` tool.
</Tip>

## Apps, Actions, and Invocations

An `App` is a codebase deployed on Kernel. You can deploy any codebase in Typescript or Python on Kernel.

An `Action` is an invokable method within an app. Actions allow your to register entry points or functions that can be triggered on-demand. Actions can call non-action methods. Apps can have multiple actions.

An `Invocation` is a single execution of an action. Invocations can be triggered via API, scheduled as a job, or run on-demand.

## Getting started: create an app

First, install the Kernel SDK for your language:

<CodeGroup>
  ```bash Typescript/Javascript theme={null}
  npm install @onkernel/sdk
  ```

  ```bash Python theme={null}
  uv pip install kernel
  ```
</CodeGroup>

Then create an app:

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel, { type KernelContext } from '@onkernel/sdk';

  const kernel = new Kernel();
  const app = kernel.app('my-app-name');
  ```

  ```python Python theme={null}
  from kernel import Kernel, KernelContext

  kernel = Kernel()
  app = kernel.App("my-app-name")
  ```
</CodeGroup>

Then, define and register an action that you want to invoke.

## Registering actions

Action methods receive two parameters:

* `runtimeContext`: Contextual information provided by Kernel during execution
* `payload`: Optional runtime data that you provide when invoking the action (max 64 KB). [Read more](/apps/invoke#payload-parameter)

You can register actions using either approach:

### Inline definition (recommended)

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  app.action('my-action-name', async (ctx: KernelContext, payload) => {
    const { tshirt_size, color, shipping_address } = payload;
    // Your action logic here
    return { order_id: 'example-order-id' };
  });
  ```

  ```python Python theme={null}
  @app.action("my-action-name")
  async def my_action_method(ctx: KernelContext, payload):
      tshirt_size = payload["tshirt_size"]
      color = payload["color"]
      shipping_address = payload["shipping_address"]
      # Your action logic here
      return {"order_id": "example-order-id"}
  ```
</CodeGroup>

### Define then register

This approach is better for larger apps, unit testing, and team collaboration since functions can be tested independently and reused across multiple actions.

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  const myActionMethod = async (ctx: KernelContext, payload) => {
    const { tshirt_size, color, shipping_address } = payload;
    // Your action logic here
    return { order_id: 'example-order-id' };
  };

  app.action('my-action-name', myActionMethod);
  ```

  ```python Python theme={null}
  async def my_action_method(ctx: KernelContext, payload):
      tshirt_size = payload["tshirt_size"]
      color = payload["color"]
      shipping_address = payload["shipping_address"]
      # Your action logic here
      return {"order_id": "example-order-id"}

  app.action("my-action-name")(my_action_method)
  ```
</CodeGroup>

## Environment variables

You can set environment variables when [deploying](/apps/deploy#environment-variables) your app. They then can be accessed in the usual way:

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  const ENV_VAR = process.env.ENV_VAR;
  const myActionMethod = async (runtimeContext, payload) => {
    // ...
  };
  ```

  ```python Python theme={null}
  import os

  ENV_VAR = os.getenv("ENV_VAR")
  def my_action_method(runtime_context, payload):
      # ...
  ```
</CodeGroup>

## Return values

Action methods can return values, which will be included in the invocation's final response.

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  const myActionMethod = async (runtimeContext, payload) => {
    const { tshirt_size, color, shipping_address } = payload;
    // ...
    return {
      order_id: "example-order-id",
    }
  };
  ```

  ```python Python theme={null}
  def my_action_method(runtime_context, payload):
      tshirt_size, color, shipping_address = (
          payload["tshirt_size"],
          payload["color"],
          payload["shipping_address"]
      )
      # ...
      return {"order_id": "example-order-id"}
  ```
</CodeGroup>

The examples above show actions returning data.

## Building browser automations with Kernel apps

To implement a browser automation or web agent, instantiate an app and define an action that creates a Kernel browser.

<Info>
  Kernel browsers launch with a default context and page. Make sure to access
  the [existing context and
  page](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)
  (`contexts()[0]` and `pages()[0]`), rather than trying to create a new one.
</Info>

<CodeGroup>
  ```typescript Typescript/Javascript theme={null}
  import Kernel, { type KernelContext } from '@onkernel/sdk';
  import { chromium } from 'playwright';

  const kernel = new Kernel();
  const app = kernel.app('browser-automation');

  app.action('get-page-title', async (ctx: KernelContext, payload) => {
    const kernelBrowser = await kernel.browsers.create({
      invocation_id: ctx.invocation_id,
    });

    const browser = await chromium.connectOverCDP(kernelBrowser.cdp_ws_url);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());

    try {
      await page.goto('https://www.google.com');
      const title = await page.title();
      return { title };
    } finally {
      await browser.close();
    }
  });
  ```

  ```python Python theme={null}
  from kernel import Kernel, KernelContext
  from playwright.async_api import async_playwright

  kernel = Kernel()
  app = kernel.App("browser-automation")

  @app.action("get-page-title")
  async def get_page_title(ctx: KernelContext, payload):
      kernel_browser = kernel.browsers.create(invocation_id=ctx.invocation_id)

      async with async_playwright() as playwright:
          browser = await playwright.chromium.connect_over_cdp(kernel_browser.cdp_ws_url)
          context = browser.contexts[0] if browser.contexts else await browser.new_context()
          page = context.pages[0] if context.pages else await context.new_page()

          try:
              await page.goto("https://www.google.com")
              title = await page.title()
              return {"title": title}
          finally:
              await browser.close()
  ```
</CodeGroup>

<Info>
  Web agent frameworks sometimes require environment variables (e.g. LLM API keys). Set them when [deploying](/apps/deploy#environment-variables) your app.
</Info>

## Next steps

Once you're happy with your app, follow [these steps](/apps/deploy) to deploy and invoke it on the Kernel platform.
> ## Documentation Index
> Fetch the complete documentation index at: https://kernel.sh/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Deploying

Kernel's app deployment process is as simple as it is fast. There are no configuration files to manage or complex CI/CD pipelines.

Once you deploy an app on Kernel, you can schedule its actions on a job or run them from other contexts. You can even run actions multiple times in parallel.

## Deploy the app

### From local directory

Use our CLI from the root directory of your project:

```bash  theme={null}
kernel deploy <entrypoint_file_name>
```

#### Notes

* The `entrypoint_file_name` is the file name where you [defined](/apps/develop) your app.
* Include a `.gitignore` file to exclude dependency folders like `node_modules` and `.venv`.

### From GitHub

You can deploy a Kernel app directly from a public or private GitHub repository using the Kernel CLI. No need to clone or manually push code.

```bash  theme={null}
kernel deploy github \
  --url https://github.com/<owner>/<repo> \
  --ref <branch|tag|commit> \
  --entrypoint <path/to/entrypoint> \
  [--path <optional/subdir>] \
  [--github-token <token>] \
  [--env KEY=value ...] \
  [--env-file .env] \
  [--version latest] \
  [--force]
```

#### Notes

* **`--path` vs `--entrypoint`:** Use `--path` to specify a subdirectory within the repo (useful for monorepos), and `--entrypoint` for the path to your app's entry file relative to that directory (or repo root if no `--path` is specified).
* The CLI automatically downloads and extracts the GitHub source code and uploads your app for deployment.
* For private repositories, provide a `--github-token` or set the `GITHUB_TOKEN` environment variable.

## Environment variables

You can set environment variables for your app using the `--env` flag. For example:

<CodeGroup>
  ```bash Typescript/Javascript (inline) theme={null}
  kernel deploy my_app.ts --env MY_ENV_VAR=my_value # Can add multiple env vars delimited by space
  ```

  ```bash Typescript/Javascript (from file) theme={null}
  kernel deploy my_app.ts --env-file .env
  ```

  ```bash Python (inline) theme={null}
  kernel deploy my_app.py --env MY_ENV_VAR=my_value # Can add multiple env vars delimited by space
  ```

  ```bash Python (from file) theme={null}
  kernel deploy my_app.py --env-file .env
  ```
</CodeGroup>

## Deployment notes

* **The dependency manifest (`package.json` for JS/TS, `pyproject.toml` for Python) must be present in the root directory of your project.**
* **For JS/TS apps, set `"type": "module"` in your `package.json`.**
* View deployment logs using: `kernel deploy logs <deployment_id> --follow`
* If you encounter a 500 error during deployment, verify that your entrypoint file name and extension are correct (e.g., `app.py` not `app` or `app.js`).
* Kernel assumes the root directory contains at least this file structure:

<CodeGroup>
  ```bash Typescript/Javascript theme={null}
  project-root/
    ├─ .gitignore # Exclude dependency folders like node_modules
    ├─ my_app.ts # Entrypoint file (can be located in a subdirectory, e.g. src/my_app.ts)
    ├─ package.json
    ├─ tsconfig.json # If using TypeScript
    └─ bun.lock | package-lock.json | pnpm-lock.yaml # One of these lockfiles
  ```

  ```bash Python theme={null}
  project-root/
    ├─ .gitignore # Exclude dependency folders like .venv
    ├─ my_app.py # Entrypoint file
    └─ pyproject.toml
  ```
</CodeGroup>

```bash  theme={null}
# Successful deployment CLI output
SUCCESS  Compressed files
SUCCESS  Deployment successful
SUCCESS  App "my_app.ts" deployed with action(s): [my-action]
INFO  Invoke with: kernel invoke my-app my-action --payload '{...}'
SUCCESS  Total deployment time: 2.78s
```

Once deployed, you can [invoke](/apps/invoke) your app from anywhere.
