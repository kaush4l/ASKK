// A time as the views write it: "14:05" in this browser's locale; "" for none or one that does not read.
export const hm = (at) => {
  const d = at == null || at === "" ? null : new Date(at)
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""
}
