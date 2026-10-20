import { type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import type Database from "better-sqlite3";
import { z } from "zod";
import { ensureNotesSchema, findNotes, getNote, recordNote, recordResult, setHidden, NoteError } from "./store.js";

export function createNotesHandlers(db: Database.Database) {
  ensureNotesSchema(db);
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
  return {
    writes,
    list: handle(req => findNotes(db, req.query)),
    detail: handle(req => getNote(db, z.string().uuid().parse(req.params.id))),
    create: handle(req => recordNote(db, req.body)),
    result: handle(req => recordResult(db, { ...req.body, note_id: req.params.id })),
    // Admin only: the caller must pass the existing /admin/* secret check before this runs.
    hide: handle(req => setHidden(db, req.body)),
  };
}
