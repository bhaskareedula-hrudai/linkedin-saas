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

  try {
    const supabase = getAdminSupabase();
    const { data, error } = await supabase
      .from('posts')
      .select('id, user_id, content, post_url, created_at, updated_at, post_id, posted_at, status')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json({ posts: data ?? [] });
  } catch (err) {
    console.error('Admin posts error:', err);
    return res.status(500).json({ error: err.message ?? 'Failed to fetch posts' });
  }
};