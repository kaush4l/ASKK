export const log = (l) => console.log("[host log]", l)
export const complete = (p) => "reply-to(" + p + ")"
export const fsRead = () => { throw "no" }
export const fsWrite = () => { throw "no" }
