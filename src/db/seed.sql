-- OpenClaw Personal OS - Seed Data
-- Bryson's projects and VIP contacts

-- Projects
INSERT INTO projects (name, client, status, priority, metadata) VALUES
  ('SWRE', 'SW Recovery Services', 'active', 1, '{"description": "SW Recovery Services - primary client"}'),
  ('Texas Tree Tops', 'Daniel', 'active', 2, '{"description": "Texas Tree Tops - Daniel Sanchez"}'),
  ('Helium Solutions', NULL, 'active', 1, '{"description": "Helium Solutions"}'),
  ('OnTrack Marketing', NULL, 'active', 2, '{"description": "OnTrack Marketing"}'),
  ('Search Tuners', 'Mike', 'active', 2, '{"description": "Search Tuners - Mike partnership"}'),
  ('Salon Esby', NULL, 'active', 3, '{"description": "Salon Esby"}'),
  ('A to Z Bail Bonds', NULL, 'active', 3, '{"description": "A to Z Bail Bonds"}'),
  ('THS Home Solar', NULL, 'active', 3, '{"description": "THS Home Solar"}');

-- VIP Contacts
-- We reference project_ids by subquery so seed is self-contained
INSERT INTO contacts (name, type, project_ids, is_vip, notes) VALUES
  (
    'Mike',
    'partner',
    (SELECT ARRAY[id] FROM projects WHERE name = 'Search Tuners'),
    true,
    'Search Tuners partner'
  ),
  (
    'Daniel Sanchez',
    'client',
    (SELECT ARRAY[id] FROM projects WHERE name = 'Texas Tree Tops'),
    true,
    'Texas Tree Tops client'
  ),
  (
    'Steven Dietz',
    'client',
    (SELECT ARRAY[id] FROM projects WHERE name = 'SWRE'),
    true,
    'SWRE'
  ),
  (
    'Hunter',
    'team',
    (SELECT ARRAY[id] FROM projects WHERE name = 'SWRE'),
    true,
    'SWRE Sales'
  ),
  (
    'Raymond',
    'team',
    (SELECT ARRAY[id] FROM projects WHERE name = 'SWRE'),
    true,
    'SWRE CS'
  ),
  (
    'Bren Morrow',
    'team',
    (SELECT ARRAY[id] FROM projects WHERE name = 'SWRE'),
    true,
    'SWRE'
  );
