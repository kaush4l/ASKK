import { Artifact, Tool } from "../../../../../backend/kernel/index.js"

// The mini desk's own artifact type (main.js: conventionDesk({artifacts: {tally}})): a count its agent keeps.
export class Tally extends Artifact {
  constructor({ id, owner }) {
    super({ name: id, title: `${id.replace(/\.tally$/, "")} tally` })
    this.kind = "tally"
    this.view = "text"
    this.keep = "day"
    this.owner = owner
    this.state = { count: 0, text: "0 counted" }
  }

  render() {
    return `${this.state.text} (${this.name}.add {n} adds to it)`
  }

  brief() {
    return this.state.text
  }

  commands() {
    const add = ({ n = 1 }) => {
      const count = this.state.count + Number(n)
      this.state = { count, text: `${count} counted` }
      this.changed()
      return this.state.text
    }
    return [new Tool({ name: `${this.name}.add`, description: "add to the count", input: { n: "how many" }, run: add })]
  }
}

export const tally = (agent) => new Tally({ id: `${agent.name}.tally`, owner: agent.board?.team ?? agent.name })
