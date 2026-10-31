import { createActor } from "xstate";
import { ganeshMachine } from "./ganesh.machine";

export class GaneshOrchestrator {
  private actor = createActor(ganeshMachine);

  constructor() {
    this.actor.start();
  }

  async handle(input: any): Promise<any> {
    return new Promise((resolve) => {
      const sub = this.actor.subscribe((state) => {
        if (state.matches({ main: "responding" })) {
          sub.unsubscribe();
          resolve(state.context.result ?? state.context);
        }
        if (state.matches({ main: "error" })) {
          sub.unsubscribe();
          resolve({ ok: false, error: state.context.error });
        }
      });
      this.actor.send({ type: "INPUT", value: input });
    });
  }

  delegate(agent: string, payload?: any) {
    this.actor.send({ type: "DELEGATE", agent, payload });
  }

  getState() {
    return this.actor.getSnapshot();
  }

  reset() {
    this.actor.send({ type: "RESET" });
  }
}
