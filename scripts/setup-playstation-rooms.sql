\set ON_ERROR_STOP on

-- Usage example (choose the initial type; it is not tied to any room number):
-- psql "$env:DATABASE_URL" -v default_playstation_type=PS4 -f scripts/setup-playstation-rooms.sql

BEGIN;
SET LOCAL drgames.default_playstation_type = :'default_playstation_type';

DO $$
DECLARE
  requested_type text := current_setting('drgames.default_playstation_type');
  collision_code text;
BEGIN
  IF requested_type NOT IN ('PS4', 'PS5') THEN
    RAISE EXCEPTION 'default_playstation_type must be PS4 or PS5';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM station_categories
    WHERE pricing_model = 'ROOM'
      AND playstation_type::text = requested_type
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'No active ROOM category exists for %; apply migration 0007 first', requested_type;
  END IF;

  SELECT expected.code
  INTO collision_code
  FROM (
    SELECT
      'ROOM-' || lpad(number::text, 2, '0') AS code,
      'Room ' || lpad(number::text, 2, '0') AS name
    FROM generate_series(1, 17) AS number
  ) expected
  INNER JOIN stations station ON upper(station.code) = expected.code
  INNER JOIN station_categories category ON category.id = station.category_id
  WHERE station.name <> expected.name OR category.pricing_model <> 'ROOM'
  LIMIT 1;

  IF collision_code IS NOT NULL THEN
    RAISE EXCEPTION '% is already used by a record that is not a matching PlayStation room', collision_code;
  END IF;
END $$;

WITH selected_category AS (
  SELECT id
  FROM station_categories
  WHERE pricing_model = 'ROOM'
    AND playstation_type::text = current_setting('drgames.default_playstation_type')
    AND is_active = true
  ORDER BY sort_order, name
  LIMIT 1
),
rooms AS (
  SELECT
    number,
    'ROOM-' || lpad(number::text, 2, '0') AS code,
    'Room ' || lpad(number::text, 2, '0') AS name
  FROM generate_series(1, 17) AS number
)
INSERT INTO stations (code, name, category_id, sort_order)
SELECT rooms.code, rooms.name, selected_category.id, rooms.number
FROM rooms
CROSS JOIN selected_category
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  configured_rooms integer;
BEGIN
  SELECT count(*)
  INTO configured_rooms
  FROM stations station
  INNER JOIN station_categories category ON category.id = station.category_id
  WHERE upper(station.code) IN (
    SELECT 'ROOM-' || lpad(number::text, 2, '0')
    FROM generate_series(1, 17) AS number
  )
    AND category.pricing_model = 'ROOM';

  IF configured_rooms <> 17 THEN
    RAISE EXCEPTION 'Expected 17 PlayStation rooms, found %; transaction rolled back', configured_rooms;
  END IF;
END $$;

COMMIT;
