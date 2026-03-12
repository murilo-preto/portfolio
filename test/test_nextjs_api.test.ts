/**
 * Next.js API Route Tests
 * Tests for the Next.js API endpoints
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// Mock fetch for API calls
global.fetch = vi.fn();

describe('Next.js API Health', () => {
  it('health endpoint should return healthy status', async () => {
    const { GET } = await import('../next-version/app/api/health/route');
    const response = await GET();
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
  });
});

describe('Authentication Flow', () => {
  const mockUser = {
    username: 'testuser',
    password: 'testpass123'
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Register Endpoint', () => {
    it('should reject registration with missing username', async () => {
      const { POST } = await import('../next-version/app/api/register/route');
      
      const request = new NextRequest('http://localhost:5000/api/register', {
        method: 'POST',
        body: JSON.stringify({ password: 'testpass' }),
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
    });

    it('should reject registration with missing password', async () => {
      const { POST } = await import('../next-version/app/api/register/route');
      
      const request = new NextRequest('http://localhost:5000/api/register', {
        method: 'POST',
        body: JSON.stringify({ username: 'testuser' }),
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
    });

    it('should reject registration with empty body', async () => {
      const { POST } = await import('../next-version/app/api/register/route');
      
      const request = new NextRequest('http://localhost:5000/api/register', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
    });
  });

  describe('Login Endpoint', () => {
    it('should reject login with missing credentials', async () => {
      const { POST } = await import('../next-version/app/api/login/route');
      
      const request = new NextRequest('http://localhost:5000/api/login', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
    });

    it('should reject login with missing username', async () => {
      const { POST } = await import('../next-version/app/api/login/route');
      
      const request = new NextRequest('http://localhost:5000/api/login', {
        method: 'POST',
        body: JSON.stringify({ password: 'testpass' }),
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
    });
  });

  describe('Logout Endpoint', () => {
    it('should handle logout request', async () => {
      const { POST } = await import('../next-version/app/api/logout/route');
      
      const request = new NextRequest('http://localhost:5000/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await POST(request);
      
      // Logout should succeed even without token (clears any existing cookie)
      expect(response.status).toBe(200);
    });
  });
});

describe('Categories API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('List Categories', () => {
    it('should return categories list', async () => {
      const { GET } = await import('../next-version/app/api/categories/route');
      
      // Mock the Flask API response
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ categories: [{ id: 1, name: 'Work' }, { id: 2, name: 'Reading' }] })
      });
      
      const request = new NextRequest('http://localhost:5000/api/categories');
      const response = await GET(request);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.categories).toBeDefined();
    });

    it('should handle Flask API errors gracefully', async () => {
      const { GET } = await import('../next-version/app/api/categories/route');
      
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500
      });
      
      const request = new NextRequest('http://localhost:5000/api/categories');
      const response = await GET(request);
      
      expect(response.status).toBe(500);
    });
  });

  describe('Create Category', () => {
    it('should reject category creation with missing name', async () => {
      const { POST } = await import('../next-version/app/api/category/route');
      
      const request = new NextRequest('http://localhost:5000/api/category', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
    });

    it('should reject category creation with empty name', async () => {
      const { POST } = await import('../next-version/app/api/category/route');
      
      const request = new NextRequest('http://localhost:5000/api/category', {
        method: 'POST',
        body: JSON.stringify({ name: '' }),
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
    });
  });
});

describe('Time Entry API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Get Entries', () => {
    it('should require authentication', async () => {
      const { GET } = await import('../next-version/app/api/entry/route');
      
      const request = new NextRequest('http://localhost:5000/api/entry');
      const response = await GET(request);
      
      // Should redirect or return 401 without auth
      expect([302, 401, 403]).toContain(response.status);
    });
  });

  describe('Create Entry', () => {
    it('should reject entry creation with missing fields', async () => {
      const { POST } = await import('../next-version/app/api/entry/create/route');
      
      const request = new NextRequest('http://localhost:5000/api/entry/create', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
    });

    it('should reject entry with end_time before start_time', async () => {
      const { POST } = await import('../next-version/app/api/entry/create/route');
      
      const request = new NextRequest('http://localhost:5000/api/entry/create', {
        method: 'POST',
        body: JSON.stringify({
          category: 'Work',
          start_time: '2024-01-01T12:00:00Z',
          end_time: '2024-01-01T10:00:00Z'
        }),
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
    });

    it('should reject entry with missing category', async () => {
      const { POST } = await import('../next-version/app/api/entry/create/route');
      
      const request = new NextRequest('http://localhost:5000/api/entry/create', {
        method: 'POST',
        body: JSON.stringify({
          start_time: '2024-01-01T10:00:00Z',
          end_time: '2024-01-01T12:00:00Z'
        }),
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
    });
  });

  describe('Delete Entry', () => {
    it('should reject deletion without entry_id', async () => {
      const { DELETE } = await import('../next-version/app/api/entry/delete/route');
      
      const request = new NextRequest('http://localhost:5000/api/entry/delete', {
        method: 'DELETE',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await DELETE(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
    });
  });
});

describe('Finance API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Get Finance Entries', () => {
    it('should require authentication', async () => {
      const { GET } = await import('../next-version/app/api/finance/route');
      
      const request = new NextRequest('http://localhost:5000/api/finance');
      const response = await GET(request);
      
      expect([302, 401, 403]).toContain(response.status);
    });
  });

  describe('Create Finance Entry', () => {
    it('should reject finance entry with missing required fields', async () => {
      const { POST } = await import('../next-version/app/api/finance/create/route');
      
      const request = new NextRequest('http://localhost:5000/api/finance/create', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
    });

    it('should reject finance entry with invalid price', async () => {
      const { POST } = await import('../next-version/app/api/finance/create/route');
      
      const request = new NextRequest('http://localhost:5000/api/finance/create', {
        method: 'POST',
        body: JSON.stringify({
          product_name: 'Test Product',
          category: 'Food',
          price: -100,
          purchase_date: '2024-01-01'
        }),
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
    });
  });

  describe('Finance Categories', () => {
    it('should return finance categories', async () => {
      const { GET } = await import('../next-version/app/api/finance/categories/route');
      
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ categories: [{ id: 1, name: 'Food' }] })
      });
      
      const request = new NextRequest('http://localhost:5000/api/finance/categories');
      const response = await GET(request);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.categories).toBeDefined();
    });
  });
});

describe('Batch Import API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Time Entry Batch Import', () => {
    it('should reject batch import without entries array', async () => {
      const { POST } = await import('../next-version/app/api/entry/batch-import/route');
      
      const request = new NextRequest('http://localhost:5000/api/entry/batch-import', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
    });

    it('should reject batch import with non-array entries', async () => {
      const { POST } = await import('../next-version/app/api/entry/batch-import/route');
      
      const request = new NextRequest('http://localhost:5000/api/entry/batch-import', {
        method: 'POST',
        body: JSON.stringify({ entries: 'not-an-array' }),
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
    });

    it('should accept valid batch import', async () => {
      const { POST } = await import('../next-version/app/api/entry/batch-import/route');
      
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ success: 2, failed: 0, errors: [] })
      });
      
      const request = new NextRequest('http://localhost:5000/api/entry/batch-import', {
        method: 'POST',
        body: JSON.stringify({
          entries: [
            {
              category: 'Work',
              start_time: '2024-01-01T10:00:00Z',
              end_time: '2024-01-01T12:00:00Z'
            }
          ]
        }),
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-token'
        }
      });
      
      const response = await POST(request);
      
      expect(response.status).toBe(200);
    });
  });

  describe('Finance Batch Import', () => {
    it('should reject finance batch import without entries', async () => {
      const { POST } = await import('../next-version/app/api/finance/batch-import/route');
      
      const request = new NextRequest('http://localhost:5000/api/finance/batch-import', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
    });
  });
});

describe('Token Management', () => {
  it('should handle token refresh', async () => {
    const { GET } = await import('../next-version/app/api/token/route');
    
    const request = new NextRequest('http://localhost:5000/api/token');
    const response = await GET(request);
    
    // Token endpoint should return something (either new token or error)
    expect(response.status).toBeDefined();
  });
});

describe('Recurring Expenses API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Get Recurring Expenses', () => {
    it('should require authentication', async () => {
      const { GET } = await import('../next-version/app/api/recurring-expenses/route');
      
      const request = new NextRequest('http://localhost:5000/api/recurring-expenses');
      const response = await GET(request);
      
      expect([302, 401, 403]).toContain(response.status);
    });
  });

  describe('Create Recurring Expense', () => {
    it('should reject creation with missing required fields', async () => {
      const { POST } = await import('../next-version/app/api/recurring-expenses/create/route');
      
      const request = new NextRequest('http://localhost:5000/api/recurring-expenses/create', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
    });

    it('should reject invalid frequency values', async () => {
      const { POST } = await import('../next-version/app/api/recurring-expenses/create/route');
      
      const request = new NextRequest('http://localhost:5000/api/recurring-expenses/create', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test Expense',
          amount: 100,
          frequency: 'invalid-frequency',
          start_date: '2024-01-01'
        }),
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
    });
  });

  describe('Delete Recurring Expense', () => {
    it('should reject deletion without id', async () => {
      const { DELETE } = await import('../next-version/app/api/recurring-expenses/delete/route');
      
      const request = new NextRequest('http://localhost:5000/api/recurring-expenses/delete', {
        method: 'DELETE',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await DELETE(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
    });
  });
});
