import { query } from "../connection.js";

export interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  imessage_handle: string | null;
  telegram_username: string | null;
  type: string | null;
  project_ids: string[] | null;
  is_vip: boolean;
  last_contact: Date | null;
  notes: string | null;
  created_at: Date;
}

export interface CreateContactInput {
  name: string;
  email?: string;
  phone?: string;
  imessage_handle?: string;
  telegram_username?: string;
  type?: string;
  project_ids?: string[];
  is_vip?: boolean;
  notes?: string;
}

export interface UpdateContactInput {
  name?: string;
  email?: string;
  phone?: string;
  imessage_handle?: string;
  telegram_username?: string;
  type?: string;
  project_ids?: string[];
  is_vip?: boolean;
  last_contact?: Date;
  notes?: string;
}

export async function getAll(): Promise<Contact[]> {
  const result = await query<Contact>(
    "SELECT * FROM contacts ORDER BY name ASC",
  );
  return result.rows;
}

export async function getById(id: string): Promise<Contact | null> {
  const result = await query<Contact>(
    "SELECT * FROM contacts WHERE id = $1",
    [id],
  );
  return result.rows[0] ?? null;
}

export async function getByEmail(email: string): Promise<Contact | null> {
  const result = await query<Contact>(
    "SELECT * FROM contacts WHERE LOWER(email) = LOWER($1)",
    [email],
  );
  return result.rows[0] ?? null;
}

export async function getByPhone(phone: string): Promise<Contact | null> {
  const result = await query<Contact>(
    "SELECT * FROM contacts WHERE phone = $1",
    [phone],
  );
  return result.rows[0] ?? null;
}

export async function getVIPs(): Promise<Contact[]> {
  const result = await query<Contact>(
    "SELECT * FROM contacts WHERE is_vip = true ORDER BY name ASC",
  );
  return result.rows;
}

export async function create(input: CreateContactInput): Promise<Contact> {
  const result = await query<Contact>(
    `INSERT INTO contacts (name, email, phone, imessage_handle, telegram_username, type, project_ids, is_vip, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.name,
      input.email ?? null,
      input.phone ?? null,
      input.imessage_handle ?? null,
      input.telegram_username ?? null,
      input.type ?? null,
      input.project_ids ?? null,
      input.is_vip ?? false,
      input.notes ?? null,
    ],
  );
  return result.rows[0]!;
}

export async function update(
  id: string,
  input: UpdateContactInput,
): Promise<Contact | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(input.name);
  }
  if (input.email !== undefined) {
    fields.push(`email = $${idx++}`);
    values.push(input.email);
  }
  if (input.phone !== undefined) {
    fields.push(`phone = $${idx++}`);
    values.push(input.phone);
  }
  if (input.imessage_handle !== undefined) {
    fields.push(`imessage_handle = $${idx++}`);
    values.push(input.imessage_handle);
  }
  if (input.telegram_username !== undefined) {
    fields.push(`telegram_username = $${idx++}`);
    values.push(input.telegram_username);
  }
  if (input.type !== undefined) {
    fields.push(`type = $${idx++}`);
    values.push(input.type);
  }
  if (input.project_ids !== undefined) {
    fields.push(`project_ids = $${idx++}`);
    values.push(input.project_ids);
  }
  if (input.is_vip !== undefined) {
    fields.push(`is_vip = $${idx++}`);
    values.push(input.is_vip);
  }
  if (input.last_contact !== undefined) {
    fields.push(`last_contact = $${idx++}`);
    values.push(input.last_contact);
  }
  if (input.notes !== undefined) {
    fields.push(`notes = $${idx++}`);
    values.push(input.notes);
  }

  if (fields.length === 0) return getById(id);

  values.push(id);

  const result = await query<Contact>(
    `UPDATE contacts SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

/**
 * Search for a contact by any handle: email, phone, imessage_handle, or telegram_username.
 */
export async function findByAnyHandle(
  handle: string,
): Promise<Contact | null> {
  const result = await query<Contact>(
    `SELECT * FROM contacts
     WHERE LOWER(email) = LOWER($1)
        OR phone = $1
        OR LOWER(imessage_handle) = LOWER($1)
        OR LOWER(telegram_username) = LOWER($1)
     LIMIT 1`,
    [handle],
  );
  return result.rows[0] ?? null;
}
