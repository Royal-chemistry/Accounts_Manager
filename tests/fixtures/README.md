# Test fixtures

These files pin down how the old (v1) app behaves, so the new code can be held to exactly the same figures.

| File | What it is |
|---|---|
| `v1-sample.json` | The sample data saved by the live v1 app, captured from it before v2 replaced it |
| `v1-edge.json` | Hand-written v1 data with the awkward things real data can contain: text where numbers belong, missing fields, removed staff and clients, unknown accounts, overpaid invoices |
| `v1-empty.json` | The smallest data the v1 app would accept |
| `dutypay-v1.json` | Data shaped like the first release, saved under the old `dutypay:v1` key |
| `v1-unsafe-ids.json` | A malicious backup with HTML inside record IDs |
| `*.golden.json` | What the v1 calculations say about each fixture, from `tests/tools/make-golden.mjs` |
| `v1-calc.js` | A frozen copy of v1's `js/calc.js`, used only to produce the golden files. Don't edit it |

The golden files are the contract: if a change makes the new code disagree with them, the change is wrong.
