import { NextRequest, NextResponse } from 'next/server'
import { suggestTagsForDraft } from '@/lib/generate-tags'

export const dynamic = 'force-dynamic'

// Suggest tags for a draft contact (form) without persisting anything.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, role, company, sector, notes } = body as {
      name?: string
      role?: string
      company?: string
      sector?: string
      notes?: string
    }

    // Require at least company or role to generate useful suggestions
    if (!company?.trim() && !role?.trim() && !notes?.trim()) {
      return NextResponse.json({ tags: [] })
    }

    const tags = await suggestTagsForDraft(
      {
        name: name || '',
        role,
        company,
        sector,
      },
      notes
    )

    return NextResponse.json({ tags })
  } catch (err) {
    console.error('Suggest tags failed:', err)
    return NextResponse.json({ tags: [], error: String(err) }, { status: 500 })
  }
}
