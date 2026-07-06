# Asset Sources

Runtime brand assets live under `public/assets/brand/`. Unused brand variants live under `docs/assets/archive/` so they stay available for reference without shipping in the public bundle.

| Asset | Runtime or archive path | Source |
|---|---|---|
| Biji-biji runtime footer mark | `public/assets/brand/biji-biji/biji-biji-logo-white.svg` | [`bbbi-mereka-brand-assets/brands/bbi/logos/svg/primary`](https://github.com/Biji-Biji-Initiative/bbbi-mereka-brand-assets/tree/main/brands/bbi/logos/svg/primary) |
| Biji-biji archived variants | `docs/assets/archive/brand/biji-biji/*.svg` | [`bbbi-mereka-brand-assets/brands/bbi/logos/svg/primary`](https://github.com/Biji-Biji-Initiative/bbbi-mereka-brand-assets/tree/main/brands/bbi/logos/svg/primary) |
| Mereka favicon PNG set | `public/assets/brand/mereka/favicon-*.png` | [`bbbi-mereka-brand-assets/brands/mereka/icons/favicon`](https://github.com/Biji-Biji-Initiative/bbbi-mereka-brand-assets/tree/main/brands/mereka/icons/favicon) |
| Mereka archived black symbol | `docs/assets/archive/brand/mereka/mereka-symbol-black.png` | Mereka brand asset export |

The source Mereka favicon exports were one pixel larger than their filenames;
the committed PNGs were resized to exact `16x16`, `32x32`, and `256x256`
browser icon sizes while preserving the canonical artwork.
