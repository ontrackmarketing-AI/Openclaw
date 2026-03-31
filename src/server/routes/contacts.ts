import { Router, type Request, type Response } from "express";
import { contactsRepo } from "../../db/repositories/index.js";
import { logger } from "../../config/logger.js";

export const contactsRouter = Router();

// GET /api/contacts
contactsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { vip } = req.query;

    let contacts;
    if (vip === "true") {
      contacts = await contactsRepo.getVIPs();
    } else {
      contacts = await contactsRepo.getAll();
    }

    res.json({ data: contacts });
  } catch (err) {
    logger.error("Failed to list contacts", { error: err });
    res.status(500).json({ error: "Failed to list contacts" });
  }
});
