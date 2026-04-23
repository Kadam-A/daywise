-- Allow users to insert/update their own subscription row (needed for self-serve trial start)
CREATE POLICY "Users can upsert own subscription" ON user_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own subscription" ON user_subscriptions
  FOR UPDATE USING (auth.uid() = user_id);
