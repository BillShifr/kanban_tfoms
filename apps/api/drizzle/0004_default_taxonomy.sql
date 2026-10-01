INSERT INTO topics (id, board_id, name, color)
SELECT gen_random_uuid(), b.id, 'Общее', '#64748b' FROM boards b
WHERE NOT EXISTS (SELECT 1 FROM topics t WHERE t.board_id=b.id AND t.name='Общее');
INSERT INTO labels (id, board_id, name, color)
SELECT gen_random_uuid(), b.id, 'Важно', '#dc2626' FROM boards b
WHERE NOT EXISTS (SELECT 1 FROM labels l WHERE l.board_id=b.id AND l.name='Важно');
INSERT INTO labels (id, board_id, name, color)
SELECT gen_random_uuid(), b.id, 'Блокер', '#7c3aed' FROM boards b
WHERE NOT EXISTS (SELECT 1 FROM labels l WHERE l.board_id=b.id AND l.name='Блокер');
