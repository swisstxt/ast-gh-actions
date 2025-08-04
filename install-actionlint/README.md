# install-actionlint

This action downloads [`actionlint`](https://github.com/rhysd/actionlint) while validating that the SHA256 hash of the install script matches the expected value supplied as parameter.

## Usage

Create a workflow file in your repository (e.g. `.github/workflows/lint.yml`):

```yaml
name: Lint

on:
  - push
  - workflow_dispatch

jobs:
  setup:
    steps:
      - uses: swisstxt/ast-gh-actions/install-actionlint@v1.0.1
        name: Install actionlint
        with:
          actionlint-version: "1.7.7"
          expected-hash: "28a0e78b3230372051c5a77840125aa2c8dc7804fce3696ef29dd52001ec3a8f"
      - name: Run actionlint
        run: ./actionlint -color
```
