import test from "node:test";
import assert from "node:assert/strict";
import { guessMember } from "./member-match.js";

const members = ["Abhishek Das", "Bhairab Mahanta", "Gargee Kakaty", "Jyotirmoy Das", "Prajnan Kumar Sarma", "Ronit Choudhury", "Sahid", "Ved Bhandary"]
  .map((name, i) => ({ id: String(i), name }));
const guess = (email, taken) => (guessMember(email, members, taken) || {}).name;

test("an email's local part picks the right card", () => {
  assert.equal(guess("jyotimoydascse@gmail.com"), "Jyotirmoy Das");
  assert.equal(guess("bhairabm1908@gmail.com"), "Bhairab Mahanta");
  assert.equal(guess("gargeekakaty161@gmail.com"), "Gargee Kakaty");
  assert.equal(guess("ronit965choudhury@gmail.com"), "Ronit Choudhury");
  assert.equal(guess("abhishek825177@gmail.com"), "Abhishek Das");
  assert.equal(guess("prajnankumarsarma102030@gmail.com"), "Prajnan Kumar Sarma");
});

test("no close card, or a taken one, gives no guess", () => {
  assert.equal(guess("zzz@example.com"), undefined);
  assert.equal(guess("jyotimoydascse@gmail.com", new Set(["3"])), undefined);
});
