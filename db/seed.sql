INSERT OR REPLACE INTO seasons (id, year, semestar, starts_at, starts_at_timezone_offset_minutes, ends_at, ends_at_timezone_offset_minutes) VALUES
  (
    '6eedfc0d-010e-449a-80ae-5f1eea3154b4',
    2020, '前学期',
    strftime('%s', '2020-05-07T00:00:00+09:00'), 9*60,
    strftime('%s', '2020-09-08T00:00:00+09:00'), 9*60
  ),
  (
    '0027595e-6317-44ad-9c9b-c115f81a8f04',
    2020, '後学期',
    strftime('%s', '2020-10-01T00:00:00+09:00'), 9*60,
    strftime('%s', '2021-02-18T00:00:00+09:00'), 9*60
  );

INSERT OR REPLACE INTO vacations (id, name, starts_at, starts_at_timezone_offset_minutes, ends_at, ends_at_timezone_offset_minutes) VALUES
  (
    'f8946737-b02a-4cdf-a5b2-b6eae0bc10de',
    '冬季休業',
    strftime('%s', '2020-12-23T00:00:00+09:00'), 9*60,
    strftime('%s', '2021-01-03T00:00:00+09:00'), 9*60
  );
