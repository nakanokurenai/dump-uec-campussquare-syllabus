/**
 * seed によって挿入するテーブル
 */
CREATE TABLE seasons (
  id TEXT PRIMARY KEY, -- uuid
  year INTEGER NOT NULL,
  semestar TEXT NOT NULL,
  starts_at INTEGER NOT NULL, -- UNIX time
  starts_at_timezone_offset_minutes INTEGER NOT NULL,
  ends_at INTEGER NOT NULL, -- UNIX time
  ends_at_timezone_offset_minutes INTEGER NOT NULL,
  CHECK (semestar = '前学期' OR semestar = '後学期')
);
CREATE UNIQUE INDEX `uq_seasons` ON seasons(year, semestar);
CREATE INDEX `idx_seasons_starts_at` ON seasons(starts_at); -- ソート用

-- 休暇期間
-- 本筋とは関係がないが、カレンダー登録時に使えるようにもっておきたいもの。期間中に発生している休暇 (冬休み) を登録されることを想定している
CREATE TABLE vacations (
  id TEXT PRIMARY KEY, -- uuid
  name TEXT NOT NULL,
  starts_at INTEGER NOT NULL, -- UNIX time
  starts_at_timezone_offset_minutes INTEGER NOT NULL,
  ends_at INTEGER NOT NULL, -- UNIX time
  ends_at_timezone_offset_minutes INTEGER NOT NULL
);
CREATE INDEX `idx_vacations_starts_at` ON vacations(starts_at);
CREATE INDEX `idx_vacations_ends_at` ON vacations(ends_at);

/**
 * アプリケーションによって操作するテーブル
 */
CREATE TABLE subject_syllabuses (
  id TEXT PRIMARY KEY, -- uuid
  html BLOB NOT NULL, -- シラバスページ HTML
  updated_at INTEGER NOT NULL, -- UNIX Time
  updated_at_timezone_offset_minutes INTEGER NOT NULL
);
CREATE INDEX `idx_subject_syllabuses_updated_at` ON subject_syllabuses(updated_at);

CREATE TABLE subjects (
  id TEXT PRIMARY KEY, -- uuid
  syllabus_id TEXT NOT NULL, -- 1-1 で必須
  season_id TEXT NOT NULL, -- 学期
  department_code INTEGER NOT NULL, -- 開講所属, jikanwariShozokuCode
  schedule_code INTEGER NOT NULL, -- 時間割コード, jikanwaricd
  `name` TEXT NOT NULL, -- updatable
  lecturers TEXT NOT NULL, -- updatable
  updated_at INTEGER NOT NULL, -- UNIX time
  updated_at_timezone_offset_minutes INTEGER NOT NULL,
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  FOREIGN KEY (syllabus_id) REFERENCES subject_syllabuses(id)
);
CREATE UNIQUE INDEX `uq_subjects` ON subjects(season_id, department_code, schedule_code);
CREATE INDEX `idx_subjects_schedule_code_department_code` ON subjects(schedule_code, department_code); -- 絞り込み用
CREATE INDEX `idx_subjects_updated_at` ON subjects(updated_at); -- ソート用

-- 複数時限に跨がって講義がある場合があるので 1-n
CREATE TABLE subject_schedules (
  id TEXT PRIMARY KEY, -- uuid
  subject_id TEXT NOT NULL,
  `weekday` INTEGER NOT NULL, -- 曜日, 1 (Mon) ~ 7 (Sun), ISO8601 weekday
  time_slot INTEGER NOT NULL, -- 時限, 1 ~ 7
  CHECK (1 <= `weekday` AND `weekday` <= 7), -- 時限は変わり得るのでここだけ
  FOREIGN KEY (subject_id) REFERENCES subjects(id)
);
CREATE INDEX `idx_subject_schedules_subject_id` ON subject_schedules(subject_id);
