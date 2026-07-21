import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Liquid Glass select coverage', () => {
  it('does not introduce native select elements in application components', () => {
    const componentDirectory = path.resolve('src/components')
    const files = fs.readdirSync(componentDirectory).filter((file) => file.endsWith('.tsx'))
    const nativeSelectFiles = files.filter((file) => fs.readFileSync(path.join(componentDirectory, file), 'utf8').includes('<select'))
    expect(nativeSelectFiles).toEqual([])
  })
})
