// Run the independently installed runner in its own process, as Actions does.
import { executeJourney } from "../../packages/runner/src/engine";
let input = "";
for await (const chunk of process.stdin) input += chunk;
process.stdout.write(
  JSON.stringify(
    await executeJourney(JSON.parse(input), { allowPrivateForFixture: true }),
  ),
);
