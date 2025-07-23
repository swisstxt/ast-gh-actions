import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { sep } from "node:path";

import { getInput, setFailed } from "@actions/core";

const scriptUrl =
  "https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash";

// TODO: Add lots of info-level logging?
const main = async () => {
  const scriptResponse = await fetch(scriptUrl);
  const scriptText = await scriptResponse.text();
  const actualHash = createHash("sha256").update(scriptText).digest("hex");

  const expectedHash = getInput("expected-hash", { required: true });
  const actionLintVersion = getInput("actionlint-version", { required: true });

  if (actualHash !== expectedHash) {
    // TODO: Test me
    setFailed(
      `Could not verify hash of remote script. Expected: ${expectedHash}, actual: ${actualHash}`
    );
    return;
  }

  const tempDir = mkdtempSync(`${tmpdir()}${sep}`);
  const tempPath = path.join(tempDir, "download-actionlint.bash");

  writeFileSync(tempPath, scriptText);

  try {
    execSync(`bash ${tempPath} "${actionLintVersion}"`, {
      stdio: "inherit",
    });
  } finally {
    rmSync(tempDir, { recursive: true });
  }
};

await main();
