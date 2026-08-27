-- Completing a planned entry once its date has passed means selecting on
-- exactly (status, purchase_date) -- once from the daily sweep across every
-- user, once per finance list read for the user reading. finance_entries had
-- no index on either column, so both were a full scan of the table.
--
-- status leads deliberately: the daily sweep has no user predicate, so an
-- index led by user_id would not serve it, and the planned-and-past-due set
-- this pair matches is near-empty once the sweep is running.
ALTER TABLE finance_entries
  ADD KEY idx_finance_entries_status_date (status, purchase_date);
