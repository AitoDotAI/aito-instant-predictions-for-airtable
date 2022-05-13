import iris from './iris'
import { SampleStatistics } from './SampleStatistics'

const rangeFilter =
  (from: number, until: number) =>
  (_: unknown, i: number): boolean =>
    i >= from && i < until

const toArrayVector = (values: number[] | Float32Array | Float64Array): number[] => {
  return [...values]
}

const toArrayMatrix = (values: number[][] | Float32Array[] | Float64Array[]): number[][] => {
  return [
    ...values.map((rowOrColumn: number[] | Float32Array | Float64Array) => {
      return [...rowOrColumn]
    }),
  ]
}

const expectedMatrix = (values: any): any => {
  return [
    ...values.map((rowOrColumn: any) => {
      return [...rowOrColumn.map((value: any) => (expect as any).closeTo(value))]
    }),
  ]
}

const expectedVector = (rowOrColumn: any): any => {
  return [...rowOrColumn.map((value: any) => (expect as any).closeTo(value))]
}

const sepalLength = iris.map((row) => row[0])
const sepalWidth = iris.map((row) => row[1])
const petalLength = iris.map((row) => row[2])
const petalWidth = iris.map((row) => row[3])

const fields = [sepalLength, sepalWidth, petalLength, petalWidth]
const fractionalPart = (x: number): number => x - Math.trunc(x)
const weights = sepalLength.map((_, i) => fractionalPart(Math.PI * (i + Math.PI)))

const sampleMean = (xs: number[]) => xs.reduce((acc, n) => acc + n / xs.length, 0)

const sampleCovariance = (xs: number[], ys: number[]) => {
  const xMean = sampleMean(xs)
  const yMean = sampleMean(ys)
  return xs.reduce((acc, x, i) => {
    const y = ys[i]
    return acc + ((x - xMean) * (y - yMean)) / (xs.length - 1)
  }, 0)
}

const sampleCovarianceMatrix = (columns: number[][]): number[][] => {
  const d = columns.length
  const C: number[][] = [...Array(d).keys()].map(() => [])

  columns.forEach((xs, i) => {
    columns.forEach((ys, j) => {
      C[i][j] = sampleCovariance(xs, ys)
    })
  })

  return C
}

const weightedSampleMean = (xs: number[], ws: number[]) => {
  const totalWeight = ws.reduce((acc, w) => acc + w, 0.0)
  return xs.reduce((acc, x, i) => acc + (ws[i] * x) / totalWeight, 0)
}

const weightedSampleCovariance = (xs: number[], ys: number[], ws: number[]) => {
  const totalWeight = ws.reduce((acc, w) => acc + w, 0.0)
  const xMean = weightedSampleMean(xs, ws)
  const yMean = weightedSampleMean(ys, ws)
  return xs.reduce((acc, x, i) => {
    const y = ys[i]
    return acc + (ws[i] * (x - xMean) * (y - yMean)) / (totalWeight - 1)
  }, 0)
}

const weightedSampleCovarianceMatrix = (columns: number[][], ws: number[]): number[][] => {
  const d = columns.length
  const C: number[][] = [...Array(d).keys()].map(() => [])

  columns.forEach((xs, i) => {
    columns.forEach((ys, j) => {
      C[i][j] = weightedSampleCovariance(xs, ys, ws)
    })
  })

  return C
}

describe('SampleStatistics', () => {
  describe('.addSample()', () => {
    it('should calculate the correct means when adding samples one-by-one', () => {
      const expected = fields.map(sampleMean)

      const sampleStatistics = new SampleStatistics(fields.length)
      iris.forEach(([a, b, c, d]) => {
        return sampleStatistics.addSample([a, b, c, d])
      })
      const result = sampleStatistics.mean

      expect(toArrayVector(result)).toEqual(expectedVector(expected))
    })

    it('should calculate the correct sample covariances matrix when adding samples one-by-one', () => {
      const expected = sampleCovarianceMatrix(fields)

      const sampleStatistics = new SampleStatistics(fields.length)
      iris.forEach(([a, b, c, d]) => {
        return sampleStatistics.addSample([a, b, c, d])
      })
      const result = sampleStatistics.covariance

      expect(toArrayMatrix(result)).toEqual(expectedMatrix(expected))
    })
  })

  describe('.addWeightedSample()', () => {
    it('should calculate the weighted means when adding samples one-by-one', () => {
      const expected = fields.map((col) => weightedSampleMean(col, weights))

      const sampleStatistics = new SampleStatistics(fields.length)
      iris.forEach(([a, b, c, d], i) => {
        return sampleStatistics.addWeightedSample([a, b, c, d], weights[i])
      })
      const result = sampleStatistics.mean

      expect(toArrayVector(result)).toEqual(expectedVector(expected))
    })

    it('should calculate the weighted sample covariances matrix when adding samples one-by-one', () => {
      const expected = weightedSampleCovarianceMatrix(fields, weights)

      const sampleStatistics = new SampleStatistics(fields.length)
      iris.forEach(([a, b, c, d], i) => {
        return sampleStatistics.addWeightedSample([a, b, c, d], weights[i])
      })
      const result = sampleStatistics.covariance

      expect(toArrayMatrix(result)).toEqual(expectedMatrix(expected))
    })
  })

  describe('.addSamples()', () => {
    const batch1 = fields.map((column) => column.filter(rangeFilter(0, 20)))
    const batch2 = fields.map((column) => column.filter(rangeFilter(20, 60)))
    const batch3 = fields.map((column) => column.filter(rangeFilter(60, column.length)))

    it('should calculate the correct means from a single batch', () => {
      const expected = fields.map(sampleMean)

      const sampleStatistics = new SampleStatistics(fields.length)
      sampleStatistics.addSamples(fields)
      const result = sampleStatistics.mean

      expect(toArrayVector(result)).toEqual(expectedVector(expected))
    })

    it('should calculate the correct means from a several batches', () => {
      const expected = fields.map(sampleMean)

      const sampleStatistics = new SampleStatistics(fields.length)
      sampleStatistics.addSamples(batch1)
      sampleStatistics.addSamples(batch2)
      sampleStatistics.addSamples(batch3)
      const result = sampleStatistics.mean

      expect(toArrayVector(result)).toEqual(expectedVector(expected))
    })

    it('should calculate the correct sample covariances matrix from a single batch', () => {
      const expected = sampleCovarianceMatrix(fields)

      const sampleStatistics = new SampleStatistics(fields.length)
      sampleStatistics.addSamples(fields)
      const result = sampleStatistics.covariance

      expect(toArrayMatrix(result)).toEqual(expectedMatrix(expected))
    })

    it('should calculate the correct sample covariances matrix from a several batches', () => {
      const expected = sampleCovarianceMatrix(fields)

      const sampleStatistics = new SampleStatistics(fields.length)
      sampleStatistics.addSamples(batch1)
      sampleStatistics.addSamples(batch2)
      sampleStatistics.addSamples(batch3)
      const result = sampleStatistics.covariance

      expect(toArrayMatrix(result)).toEqual(expectedMatrix(expected))
    })
  })

  describe('.addWeightedSamples()', () => {
    const batch1 = fields.map((column) => column.filter(rangeFilter(0, 20)))
    const batch1Weights = weights.filter(rangeFilter(0, 20))

    const batch2 = fields.map((column) => column.filter(rangeFilter(20, 60)))
    const batch2Weights = weights.filter(rangeFilter(20, 60))

    const batch3 = fields.map((column) => column.filter(rangeFilter(60, column.length)))
    const batch3Weights = weights.filter(rangeFilter(60, weights.length))

    it('should calculate the correct means from a single batch', () => {
      const expected = fields.map((col) => weightedSampleMean(col, weights))

      const sampleStatistics = new SampleStatistics(fields.length)
      sampleStatistics.addWeightedSamples(fields, weights)
      const result = sampleStatistics.mean

      expect(toArrayVector(result)).toEqual(expectedVector(expected))
    })

    it('should calculate the correct means from a several batches', () => {
      const expected = fields.map((col) => weightedSampleMean(col, weights))

      const sampleStatistics = new SampleStatistics(fields.length)
      sampleStatistics.addWeightedSamples(batch1, batch1Weights)
      sampleStatistics.addWeightedSamples(batch2, batch2Weights)
      sampleStatistics.addWeightedSamples(batch3, batch3Weights)
      const result = sampleStatistics.mean

      expect(toArrayVector(result)).toEqual(expectedVector(expected))
    })

    it('should calculate the correct sample covariances matrix from a single batch', () => {
      const expected = weightedSampleCovarianceMatrix(fields, weights)

      const sampleStatistics = new SampleStatistics(fields.length)
      sampleStatistics.addWeightedSamples(fields, weights)
      const result = sampleStatistics.covariance

      expect(toArrayMatrix(result)).toEqual(expectedMatrix(expected))
    })

    it('should calculate the correct sample covariances matrix from a several batches', () => {
      const expected = weightedSampleCovarianceMatrix(fields, weights)

      const sampleStatistics = new SampleStatistics(fields.length)
      sampleStatistics.addWeightedSamples(batch1, batch1Weights)
      sampleStatistics.addWeightedSamples(batch2, batch2Weights)
      sampleStatistics.addWeightedSamples(batch3, batch3Weights)
      const result = sampleStatistics.covariance

      expect(toArrayMatrix(result)).toEqual(expectedMatrix(expected))
    })
  })
})
