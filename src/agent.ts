import { Agent } from "agents";

export class MainAgent extends Agent {
  initialState = {
    status: "ready",
    message: "WebProof AI Agent hazır."
  };

  async onConnect() {
    this.setState({
      status: "ready",
      message: "WebProof AI Agent bağlandı."
    });
  }
}
