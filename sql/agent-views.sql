DROP VIEW IF EXISTS v_anomaly;
CREATE VIEW v_anomaly AS
SELECT
  c.run_day,
  c.stable_key,
  c.heat,
  c.size,
  j.status AS crawl_status
FROM communities c
JOIN jobs j ON j.run_id = c.run_id AND j.kind = 'crawl';

DROP VIEW IF EXISTS v_trending;
CREATE VIEW v_trending AS
SELECT
  c.stable_key,
  c.run_day,
  c.heat,
  c.label_vi
FROM communities c
ORDER BY c.run_day DESC, c.heat DESC;

DROP VIEW IF EXISTS v_assumption;
CREATE VIEW v_assumption AS
SELECT e.id, e.scope_id, e.model, e.counter
FROM extracts e
WHERE e.counter IS NULL OR e.counter = '';
