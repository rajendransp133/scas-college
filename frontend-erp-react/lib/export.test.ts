import { describe, expect, it } from "vitest"
import { parseCsv, toCsv } from "./export"

describe("toCsv", () => {
  it("quotes cells containing commas, quotes or newlines", () => {
    expect(toCsv([["a,b", 'say "hi"', "x\ny"]])).toBe('"a,b","say ""hi""","x\ny"')
  })

  it("neutralises text that a spreadsheet would run as a formula", () => {
    expect(toCsv([["=1+1", "+91 98", "@cmd", "-x"]])).toBe("'=1+1,'+91 98,'@cmd,'-x")
  })

  it("leaves numbers (including negatives) and ordinary text alone", () => {
    expect(toCsv([[-3, 42, "2026-10-19", "Name"]])).toBe("-3,42,2026-10-19,Name")
  })
})

describe("parseCsv", () => {
  it("strips a leading BOM so a re-uploaded export parses", () => {
    expect(parseCsv("﻿rollNumber,name\nR1,Asha\n")).toEqual([
      ["rollNumber", "name"],
      ["R1", "Asha"],
    ])
  })

  it("round-trips quoted fields and CRLF", () => {
    expect(parseCsv('"a,b","q""t"\r\nc,d')).toEqual([
      ["a,b", 'q"t'],
      ["c", "d"],
    ])
  })
})
