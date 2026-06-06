const { createClient } = require('@supabase/supabase-js');

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured.' });
  }

  const { type } = req.query;

  try {
    const supabase = getAdminSupabase();

    if (type === 'posts') {
      const { data, error } = await supabase
        .from('posts')
        .select('id, user_id, content, post_url, created_at, updated_at, post_id, posted_at, status')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ posts: data ?? [] });
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('user_id, email, auth_roles, created_at, selected_plan, subscription_status, stripe_subscription_id')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.status(200).json({ users: data ?? [] });

  } catch (err) {
    console.error('Admin data error:', err);
    return res.status(500).json({ error: err.message ?? 'Failed to fetch data' });
  }
};