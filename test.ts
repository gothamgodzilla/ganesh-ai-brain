import { GaneshOrchestrator } from "./src/ganeshOrchestrator";

const ganesh = new GaneshOrchestrator();

(async () => {
  const result = await ganesh.handle("Teach the full framework to the second brain");
  console.log("Ganesh output:", result);
})();
