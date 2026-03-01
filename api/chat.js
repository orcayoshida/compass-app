export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type, company, industry, answers } = req.body;

  let systemPrompt = '';
  let userMessage = '';

  if (type === 'questions') {
    systemPrompt = `あなたは就活生のキャリアコーチです。就活生が企業を選ぶ前に、表面的な条件（給与・知名度・安定性）ではなく、自分の価値観・強み・人生観と企業が本当に合っているかを深く内省できるよう、鋭い質問を生成してください。質問は答えるのが少し怖くなるくらい本質的なものにしてください。`;
    userMessage = `企業名：${company}\n業界：${industry}\n\nこの企業・業界を選ぶ前に自分自身に問うべき10の質問を生成してください。\n\n必ず以下のJSON形式のみで返答してください。前置きや説明は不要です：\n{"questions": ["質問1", "質問2", "質問3", "質問4", "質問5", "質問6", "質問7", "質問8", "質問9", "質問10"]}`;
  } else if (type === 'summary') {
    systemPrompt = `あなたは就活生のキャリアコーチです。就活生の回答内容を深く分析し、その人が企業選びで本当に大切にしていることを見抜いてください。表面的なまとめではなく、回答の裏にある価値観・恐れ・願望を洞察してください。`;
    userMessage = `以下は就活生が自己内省のために答えた質問と回答です：\n\n${answers}\n\nこれらの回答をもとに「あなたが企業選びで本当に大切にしていること」を3点で要約してください。\n\n必ず以下のJSON形式のみで返答してください：\n{"title": "あなたの軸", "points": [{"label": "軸1のタイトル", "description": "詳しい説明"}, {"label": "軸2のタイトル", "description": "詳しい説明"}, {"label": "軸3のタイトル", "description": "詳しい説明"}], "message": "就活生へのエールメッセージ（2〜3文）"}`;
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    const text = data.content[0].text;

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Invalid response format', raw: text });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
