const express = require('express');
const router = express.Router();
const pool = require('../db');

// Helper: map DB row to frontend-expected shape
function mapCat(row) {
    return {
        category_id:   row.id,
        category_name: row.name,
        description:   row.description,
        is_active:     row.is_active,
        created_at:    row.created_at,
        updated_at:    row.updated_at,
    };
}

// GET /expense-categories — all categories
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM expense_categories ORDER BY name ASC'
        );
        res.json(result.rows.map(mapCat));
    } catch (err) {
        console.error('[expense-categories GET /]', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /expense-categories/active — active only
router.get('/active', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM expense_categories WHERE is_active = true ORDER BY name ASC'
        );
        res.json(result.rows.map(mapCat));
    } catch (err) {
        console.error('[expense-categories GET /active]', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /expense-categories/:id — single category
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT * FROM expense_categories WHERE id = $1',
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Category not found' });
        }
        res.json(mapCat(result.rows[0]));
    } catch (err) {
        console.error('[expense-categories GET /:id]', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /expense-categories — create
router.post('/', async (req, res) => {
    try {
        const { category_name, description, is_active } = req.body;
        if (!category_name) {
            return res.status(400).json({ error: 'Category name is required' });
        }
        const result = await pool.query(
            `INSERT INTO expense_categories (name, description, is_active)
             VALUES ($1, $2, $3) RETURNING *`,
            [category_name, description || null, is_active !== undefined ? is_active : true]
        );
        res.status(201).json({
            message: 'Category created successfully',
            category: mapCat(result.rows[0])
        });
    } catch (err) {
        console.error('[expense-categories POST]', err.message);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Category name already exists' });
        }
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /expense-categories/:id — update
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { category_name, description, is_active } = req.body;
        const result = await pool.query(
            `UPDATE expense_categories
             SET name = $1, description = $2, is_active = $3, updated_at = CURRENT_TIMESTAMP
             WHERE id = $4 RETURNING *`,
            [category_name, description, is_active, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Category not found' });
        }
        res.json({
            message: 'Category updated successfully',
            category: mapCat(result.rows[0])
        });
    } catch (err) {
        console.error('[expense-categories PUT /:id]', err.message);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Category name already exists' });
        }
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /expense-categories/:id
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const expenseCheck = await pool.query(
            'SELECT COUNT(*) FROM expenses WHERE category_id = $1', [id]
        );
        if (parseInt(expenseCheck.rows[0].count) > 0) {
            return res.status(400).json({
                error: 'Cannot delete category with existing expenses. Mark as inactive instead.'
            });
        }
        const result = await pool.query(
            'DELETE FROM expense_categories WHERE id = $1 RETURNING *', [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Category not found' });
        }
        res.json({ message: 'Category deleted successfully' });
    } catch (err) {
        console.error('[expense-categories DELETE /:id]', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
