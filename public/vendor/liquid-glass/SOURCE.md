# Vendored Liquid Glass

Source: https://github.com/lucaperullo/simple-liquid-glass/tree/9f1ca87d360d9a1f0e318ab804156c8f9c1

Optical engine and shaders unchanged. Integration fix in src/web-component/index.ts: defer ResizeObserver render via one cancellable requestAnimationFrame, and cancel it on disconnect, to avoid a WebKit ResizeObserver delivery-loop error. No other upstream source changes. Bundled with esbuild 0.25.12, html-to-image 1.11.11; IIFE, target safari15. Source package.json says 5.3.1, but that version was unavailable on npm at retrieval, so this build is pinned to the Git revision above. No upstream install/build scripts were executed. Retained MIT notices beside this file.
