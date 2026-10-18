import { test } from "node:test";
import assert from "node:assert/strict";
import { createMatch, matchWinner, gamesNeeded, gamesWon, nextGame, applyMove, playerUp, visits, replay, cleanTeam, targetWords } from "../js/core/match.js";

const play = (m, ...moves) => moves.reduce((acc, e) => applyMove(acc, e), m);

test("a match keeps only the settings its game uses", () => {
  const s = createMatch({ game: "snooker", players: ["A", "B"], reds: 6 });
  assert.equal(s.game, "snooker");
  assert.equal(s.reds, 6);
  assert.equal(s.target, undefined, "keep playing: no target");
  assert.equal(s.teams, undefined);
  const p = createMatch({ game: "pool", players: ["A", "B"], target: 3, teams: [["A1", "A2"], ["B1"]] });
  assert.equal(p.game, "pool");
  assert.equal(p.reds, undefined);
  assert.equal(p.target, 3);
  assert.deepEqual(p.teams, [["A1", "A2"], ["B1"]]);
  assert.equal(createMatch({ game: "pool", players: ["A", "B"], teams: [["A"], ["B"]] }).teams, undefined, "one player a side isn't doubles");
  assert.equal(targetWords(3), "best of 5");
  assert.equal(targetWords(0), "");
});

test("best of 3: the first to 2 games wins, and there's no game after that", () => {
  let m = createMatch({ game: "pool", players: ["A", "B"], target: 2 });
  assert.deepEqual(gamesNeeded(m), [2, 2]);
  m = play(m, { t: "concede", who: 1 }, { t: "next" });
  assert.deepEqual(gamesWon(m), [1, 0]);
  assert.equal(matchWinner(m), null);
  assert.deepEqual(gamesNeeded(m), [1, 2]);
  m = play(m, { t: "concede", who: 1 });
  assert.equal(matchWinner(m), 0);
  assert.throws(() => nextGame(m), /match is over/);
  assert.throws(() => applyMove(m, { t: "next" }));
  assert.equal(matchWinner(play(createMatch({ game: "pool", players: ["A", "B"] }), { t: "concede", who: 1 })), null, "no target: never over");
});

test("moves: undo steps back, even into the last game on this phone; bad moves change nothing", () => {
  let m = createMatch({ game: "snooker", players: ["A", "B"], reds: 6 });
  m = play(m, { t: "pot", ball: "red" }, { t: "call", ball: "pink" });
  assert.equal(replay(m).called, "pink");
  m = applyMove(m, { t: "undo" });
  assert.equal(replay(m).called, null);
  assert.throws(() => applyMove(m, { t: "toss", who: 0 }), "no coin toss is due");
  m = play(m, { t: "concede", who: 0 }, { t: "next" });
  assert.equal(m.frames.length, 2);
  m = applyMove(m, { t: "undo" });
  assert.equal(m.frames.length, 1, "undo on an empty game goes back to the last one");
  assert.equal(applyMove(m, { t: "undo" }, 0).frames[0].events.length, m.frames[0].events.length - 1);
  assert.deepEqual(applyMove(m, { t: "restart" }), m, "restarts are the Worker's to decide");
  assert.throws(() => applyMove(m, { t: "miss" }), "that game is over: nothing more fits");
});

test("doubles: partners take turns at the table, and each game starts one player on", () => {
  let m = createMatch({ game: "snooker", players: ["Pinks", "Blues"], teams: [["Ann", "Bea"], ["Cal", "Dev"]], reds: 6, breaker: 0 });
  const up = () => playerUp(m, replay(m).turn);
  assert.equal(up(), "Ann");
  m = applyMove(m, { t: "pot", ball: "red" });
  assert.equal(up(), "Ann", "still Ann's visit");
  m = applyMove(m, { t: "miss" });
  assert.equal(up(), "Cal");
  m = applyMove(m, { t: "miss" });
  assert.equal(up(), "Bea");
  m = applyMove(m, { t: "miss" });
  assert.equal(up(), "Dev");
  m = applyMove(m, { t: "foul", kind: "nothing" });
  assert.equal(up(), "Ann", "after Dev's foul, the Pinks' next player: back round to Ann");
  m = applyMove(m, { t: "again" });
  assert.equal(up(), "Dev", "made to play again: Dev carries on, and it wasn't a visit for the Pinks");
  assert.deepEqual(visits(m), [2, 2]);
  assert.equal(playerUp(m, 1, 1), "Dev", "game 2: the Blues break, starting one player on");
  m = play(m, { t: "concede", who: 0 }, { t: "next" });
  assert.equal(up(), "Dev");
  assert.equal(playerUp(m, 0), "Bea");
  assert.equal(playerUp(createMatch({ game: "pool", players: ["A", "B"] }), 0), "A", "singles: the side's name");
});

test("team names are tidied", () => {
  assert.deepEqual(cleanTeam(["  Ann  ", "", "Bea   Lee", null, "x".repeat(40), "E"]), ["Ann", "Bea Lee", "x".repeat(24), "E"]);
});

test("doubles in pool: 'make them break again' gives the break back to the same player", () => {
  let m = createMatch({ game: "pool", players: ["A", "B"], teams: [["Ann", "Cal"], ["Bea", "Dev"]], breaker: 0 });
  m = applyMove(m, { t: "shot", potted: [], rail: false }); // illegal break: Bea chooses
  assert.equal(playerUp(m, replay(m).turn), "Bea");
  m = applyMove(m, { t: "choose", opt: "rerack-them" });
  assert.equal(playerUp(m, replay(m).turn), "Ann", "Ann broke, Ann breaks again");
  assert.deepEqual(visits(m), [1, 0]);
});
