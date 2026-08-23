const express = require('express');
const router = express.Router();
const pool = require('../db');

// Helper: map DB row → frontend-expected shape
function mapExp(row) {
    return {
        expense_id:     row.id,
        expense_title:  row.title,
        amount:         parseFloat(row.amount) || 0,
        category_id:    row.category_id,
        category_name:  row.category_name || null,
        expense_date:   row.expense_date,
        payment_method: row.payment_method || null,
        reference_no:   row.reference_no   || null,
        paid_to:        row.paid_to        || null,
        description:    row.description    || null,
        status:         row.status         || 'pending',
        created_by:     row.created_by     || null,
        created_at:     row.created_at,
        updated_at:     row.updated_at     || null,
    };
}

// ─── GET /expenses ────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const {
            category_id, status, from_date, to_date,
            payment_method, search,
            page = 1, limit = 50
        } = req.query;

        let where = 'WHERE 1=1';
        const params = [];
        let n = 0;

        if (category_id)    { n++; where += ` AND e.category_id = $${n}`;                                           params.push(category_id); }
        if (status)         { n++; where += ` AND e.status = $${n}`;                                                params.push(status); }
        if (from_date)      { n++; where += ` AND e.expense_date >= $${n}`;                                         params.push(from_date); }
        if (to_date)        { n++; where += ` AND e.expense_date <= $${n}`;                                         params.push(to_date); }
        if (payment_method) { n++; where += ` AND e.payment_method = $${n}`;                                        params.push(payment_method); }
        if (search)         { n++; where += ` AND (e.title ILIKE $${n} OR e.paid_to ILIKE $${n} OR e.reference_no ILIKE $${n})`; params.push(`%${search}%`); }

        const offset = (parseInt(page) - 1) * parseInt(limit);

        const dataQuery = `
            SELECT e.*, ec.name AS category_name
            FROM expenses e
            LEFT JOIN expense_categories ec ON e.category_id = ec.id
            ${where}
            ORDER BY e.expense_date DESC, e.created_at DESC
            LIMIT $${n + 1} OFFSET $${n + 2}
        `;
        const countQuery = `SELECT COUNT(*) FROM expenses e ${where}`;

        const [dataRes, countRes] = await Promise.all([
            pool.query(dataQuery, [...params, parseInt(limit), offset]),
            pool.query(countQuery, params),
        ]);

        const total = parseInt(countRes.rows[0].count);
        res.json({
            expenses:   dataRes.rows.map(mapExp),
            total,
            page:       parseInt(page),
            limit:      parseInt(limit),
            totalPages: Math.ceil(total / parseInt(limit)),
        });
    } catch (err) {
        console.error('[expenses GET /]', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── GET /expenses/stats/summary ──────────────────────────────
router.get('/stats/summary', async (req, res) => {
    try {
        const { from_date, to_date, category_id } = req.query;
        let where = 'WHERE 1=1';
        const params = [];
        let n = 0;

        if (from_date)   { n++; where += ` AND expense_date >= $${n}`; params.push(from_date); }
        if (to_date)     { n++; where += ` AND expense_date <= $${n}`; params.push(to_date); }
        if (category_id) { n++; where += ` AND category_id = $${n}`;  params.push(category_id); }

        const result = await pool.query(
            `SELECT
                COUNT(*)                                                             AS total_expenses,
                COALESCE(SUM(amount), 0)                                             AS total_amount,
                COALESCE(SUM(CASE WHEN status='approved' THEN amount ELSE 0 END), 0) AS approved_amount,
                COALESCE(SUM(CASE WHEN status='pending'  THEN amount ELSE 0 END), 0) AS pending_amount
             FROM expenses ${where}`,
            params
        );
        const row = result.rows[0];
        res.json({
            total_expenses:   parseInt(row.total_expenses)      || 0,
            total_amount:     parseFloat(row.total_amount)      || 0,
            approved_amount:  parseFloat(row.approved_amount)   || 0,
            pending_amount:   parseFloat(row.pending_amount)    || 0,
        });
    } catch (err) {
        console.error('[expenses GET /stats/summary]', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── GET /expenses/stats/by-category ──────────────────────────
router.get('/stats/by-category', async (req, res) => {
    try {
        const { from_date, to_date } = req.query;
        let having = '';
        const params = [];
        let n = 0;

        if (from_date || to_date) {
            having = 'WHERE 1=1';
            if (from_date) { n++; having += ` AND e.expense_date >= $${n}`; params.push(from_date); }
            if (to_date)   { n++; having += ` AND e.expense_date <= $${n}`; params.push(to_date); }
        }

        const result = await pool.query(
            `SELECT ec.name AS category_name,
                    COUNT(e.id)             AS expense_count,
                    COALESCE(SUM(e.amount), 0) AS total_amount
             FROM expense_categories ec
             LEFT JOIN expenses e ON ec.id = e.category_id ${having}
             GROUP BY ec.name
             ORDER BY total_amount DESC`,
            params
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[expenses GET /stats/by-category]', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── GET /expenses/:id ────────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT e.*, ec.name AS category_name
             FROM expenses e
             LEFT JOIN expense_categories ec ON e.category_id = ec.id
             WHERE e.id = $1`,
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
        res.json(mapExp(result.rows[0]));
    } catch (err) {
        console.error('[expenses GET /:id]', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── POST /expenses ───────────────────────────────────────────
router.post('/', async (req, res) => {
    try {
        const {
            category_id, expense_title, amount, expense_date,
            payment_method, reference_no, paid_to, description, status
        } = req.body;

        if (!category_id || !expense_title || !amount) {
            return res.status(400).json({ error: 'Category, title, and amount are required' });
        }

        const result = await pool.query(
            `INSERT INTO expenses
               (category_id, title, amount, expense_date,
                payment_method, reference_no, paid_to, description, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             RETURNING *`,
            [
                category_id, expense_title, amount,
                expense_date || new Date().toISOString().split('T')[0],
                payment_method || null, reference_no || null,
                paid_to || null, description || null,
                status || 'pending'
            ]
        );
        res.status(201).json({
            message: 'Expense created successfully',
            expense: mapExp(result.rows[0])
        });
    } catch (err) {
        console.error('[expenses POST]', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── PUT /expenses/:id ────────────────────────────────────────
router.put('/:id', async (req, res) => {
    try {
        const {
            category_id, expense_title, amount, expense_date,
            payment_method, reference_no, paid_to, description, status
        } = req.body;

        const result = await pool.query(
            `UPDATE expenses SET
                category_id    = $1, title          = $2, amount        = $3,
                expense_date   = $4, payment_method = $5, reference_no  = $6,
                paid_to        = $7, description    = $8, status        = $9,
                updated_at     = CURRENT_TIMESTAMP
             WHERE id = $10 RETURNING *`,
            [
                category_id, expense_title, amount, expense_date,
                payment_method, reference_no, paid_to, description,
                status || 'pending', req.params.id
            ]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
        res.json({ message: 'Expense updated successfully', expense: mapExp(result.rows[0]) });
    } catch (err) {
        console.error('[expenses PUT /:id]', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── PATCH /expenses/:id/status ───────────────────────────────
router.patch('/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        if (!['pending', 'approved', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        const result = await pool.query(
            `UPDATE expenses SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
            [status, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
        res.json({ message: 'Status updated', expense: mapExp(result.rows[0]) });
    } catch (err) {
        console.error('[expenses PATCH /:id/status]', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── DELETE /expenses/:id ─────────────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM expenses WHERE id = $1 RETURNING *', [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
        res.json({ message: 'Expense deleted successfully' });
    } catch (err) {
        console.error('[expenses DELETE /:id]', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
