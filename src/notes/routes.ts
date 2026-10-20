import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import type Database from "better-sqlite3";
import { z } from "zod";
import { ensureNotesSchema, findNotes, getNote, recordNote, recordResult, NoteError } from "./store.js";

export function createNotesRouter(db: Database.Database) {
  ensureNotesSchema(db);
  const router = Router();
  const writes = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false });
  function handle(run: (req: Request) => unknown) {
    return (req: Request, res: Response) => {
      res.setHeader("Cache-Control", "no-store");
      try { res.json(run(req)); }
      catch (e) {
        if (e instanceof z.ZodError) { res.status(400).json({ error: "invalid_note_input" }); return; }
        if (e instanceof NoteError) { res.status(e.status).json({ error: e.message }); return; }
        res.status(500).json({ error: "notes_unavailable" });
      }
    };
  }
  router.get("/notes", handle(req => findNotes(db, req.query)));
  router.get("/notes/:id", handle(req => getNote(db, z.string().uuid().parse(req.params.id))));
  router.post("/notes", writes, handle(req => recordNote(db, req.body)));
  router.post("/notes/:id/results", writes, handle(req => recordResult(db, { ...req.body, note_id: req.params.id })));
  return router;
}
