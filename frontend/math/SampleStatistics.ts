export type Vector = number[] | Float32Array | Float64Array

interface PartialSum {
  readonly weightSum: number
  readonly squaredWeightSum: number
  readonly sum: number
}

const partialSum = (weightSum: number, sum: number, squaredWeightSum: number = 0): PartialSum => ({
  weightSum,
  sum,
  squaredWeightSum,
})

const triangular = (n: number): number => (n * (n + 1)) / 2

const diagonal = (i: number, d: number): number => (i * (2 * d - i + 1)) / 2

const mean = (sum: number, weightSum: number): number => (weightSum <= 0 ? 0 : sum / weightSum)

const addElementwise = (dest: Vector, src: Vector): void => {
  if (dest.length !== src.length) {
    throw new Error()
  }

  const n = dest.length
  for (let i = 0; i < n; i++) {
    dest[i] += src[i]
  }
}

const square = (n: number): number => n * n

const weightedSum = (a: Vector, w: Vector): PartialSum => {
  const n = a.length
  let sum = 0
  let weightSum = 0
  if (w.length < n) {
    throw new Error()
  }
  for (let i = 0; i < n; i++) {
    const term = a[i] * w[i]
    if (isFinite(term)) {
      sum += term
      weightSum += w[i]
    }
  }
  return partialSum(weightSum, sum)
}

const weightedCoMoment = (xs: Vector, xMean: number, ys: Vector, yMean: number, ws: Vector): PartialSum => {
  const n = xs.length
  if (ys.length < n) {
    throw new Error()
  }
  if (ws.length < n) {
    throw new Error()
  }

  if (!isFinite(xMean) || !isFinite(yMean)) {
    return partialSum(0, NaN)
  }

  let weightSum = 0
  let squaredWeightSum = 0
  let moment = 0

  for (let i = 0; i < n; i++) {
    const term = ws[i] * (xs[i] - xMean) * (ys[i] - yMean)

    if (isFinite(term)) {
      weightSum += ws[i]
      squaredWeightSum += ws[i] * ws[i]
      moment += term
    }
  }
  return partialSum(weightSum, moment, squaredWeightSum)
}

export class SampleStatistics {
  constructor(d: number) {
    d = d | 0
    this.d = d
    this.sums = new Float64Array(d)
    this.moments = new Float64Array(triangular(d))
    this.weightSums = new Float64Array(triangular(d))
    this.squaredWeightSums = new Float64Array(triangular(d))
  }

  // Number of dimensions of the data
  private readonly d: number

  // d-vector of 𝚺 wᵢxᵢ for every non-NaN xᵢ
  private readonly sums: Float64Array

  // d×d symmetric matrix of moments/co-moments 𝚺 wᵢ(xᵢ - x̄)(yᵢ - ȳ) for
  // every pair of non-NaN (xᵢ, yᵢ)
  //
  // Only one copy of the symetrical entries are stored: the first d elements of
  // the array contains the first row/column, the next (d-1) elements is the
  // second row/column starting from the diagonal, and so on
  private readonly moments: Float64Array

  // like {moments}, except it contains 𝚺 wᵢ of every pair of non-NaN (xᵢ, yᵢ)
  private readonly weightSums: Float64Array

  // like {weightSums}, except it contains 𝚺 wᵢ²
  private readonly squaredWeightSums: Float64Array

  public get mean(): Float64Array {
    const d = this.d
    const mu = new Float64Array(d)

    for (let i = 0; i < d; i++) {
      const ii = diagonal(i, d)
      mu[i] = mean(this.sums[i], this.weightSums[ii])
    }

    return mu
  }

  public get covariance(): Float64Array[] {
    const d = this.d
    const C = [...Array(d).keys()].map(() => new Float64Array(d))

    for (let i = 0; i < d; i++) {
      const ii = diagonal(i, d)

      C[i][i] = mean(this.moments[ii], this.weightSums[ii] - 1)

      for (let j = i; j < d; j++) {
        const ij = ii + j - i

        const cov = mean(this.moments[ij], this.weightSums[ij] - 1)
        C[i][j] = cov
        C[j][i] = cov
      }
    }

    return C
  }

  public debug(): string {
    const d = this.d
    const moments = [...Array(d + 1).keys()].map(() => '')
    const weights = [...Array(d + 1).keys()].map(() => '')
    const squaredWeights = [...Array(d + 1).keys()].map(() => '')

    for (let i = 0; i < d; i++) {
      const ii = diagonal(i, d)

      for (let j = 0; j < d; j++) {
        const ij = ii + j - i

        if (j < i) {
          continue
        }

        moments[j] += this.moments[ij] + (i + 1 < d ? ', ' : '')
        weights[j] += this.weightSums[ij] + (i + 1 < d ? ', ' : '')
        squaredWeights[j] += this.squaredWeightSums[ij] + (i + 1 < d ? ', ' : '')
      }
    }

    const ms = moments.join('\n')
    const ws = weights.join('\n')
    const w2s = squaredWeights.join('\n')

    return `Sums:\n${this.sums.join('\n')}\nMoments:\n${ms}Weights:\n${ws}Squared weights:\n${w2s}`
  }

  public addSample(sampleRow: Vector): SampleStatistics {
    return this.addWeightedSample(sampleRow, 1)
  }

  public addWeightedSample(sampleRow: Vector, weight: number): SampleStatistics {
    const d = this.d

    if (sampleRow.length < d) {
      throw new Error()
    }

    const squaredWeight = weight * weight

    for (let i = 0; i < d; i++) {
      if (!isFinite(sampleRow[i])) {
        // Trade NaNs and infinities for some bias
        continue
      }

      const ii = diagonal(i, d)
      const iOldMean = mean(this.sums[i], this.weightSums[ii])

      const newSum = this.sums[i] + weight * sampleRow[i]
      const newWeightSum = this.weightSums[ii] + weight
      const iNewMean = mean(newSum, newWeightSum)

      this.moments[ii] = this.moments[ii] + weight * (sampleRow[i] - iNewMean) * (sampleRow[i] - iOldMean)

      for (let j = i + 1; j < d; j++) {
        if (!isFinite(sampleRow[j])) {
          // Trade NaNs and infinities for some bias
          continue
        }

        const jj = diagonal(j, d)
        const ij = ii + j - i

        const jOldMean = mean(this.sums[j], this.weightSums[jj])
        this.moments[ij] += weight * (sampleRow[i] - iNewMean) * (sampleRow[j] - jOldMean)

        this.weightSums[ij] += weight
        this.squaredWeightSums[ij] += squaredWeight
      }

      this.sums[i] = newSum
      this.weightSums[ii] = newWeightSum
      this.squaredWeightSums[ii] += squaredWeight
    }

    return this
  }

  public addSamples(sampleColumns: Vector[]): SampleStatistics {
    const ones = new Float64Array(sampleColumns[0]?.length || 0)
    ones.fill(1)
    return this.addWeightedSamples(sampleColumns, ones)
  }

  public addWeightedSamples(sampleColumns: Vector[], weights: Vector): SampleStatistics {
    const d = sampleColumns.length

    const weightedSums = sampleColumns.map((column) => weightedSum(column, weights))
    const sums = new Float64Array(weightedSums.map(({ sum }) => sum))
    const meanSums = new Float64Array(weightedSums.map(({ weightSum: count }) => count))

    const moments = new Float64Array(triangular(d))
    const weightSums = new Float64Array(triangular(d))
    const squaredWeightSums = new Float64Array(triangular(d))

    for (let i = 0; i < d; i++) {
      const xs = sampleColumns[i]
      const xMean = mean(sums[i], meanSums[i])

      for (let j = i; j < d; j++) {
        const ij = diagonal(i, d) + j - i

        const yMean = mean(sums[j], meanSums[j])
        const ys = sampleColumns[j]

        const { sum, weightSum, squaredWeightSum } = weightedCoMoment(xs, xMean, ys, yMean, weights)

        moments[ij] = sum
        weightSums[ij] = weightSum
        squaredWeightSums[ij] = squaredWeightSum
      }
    }

    return this.mergeStatistics(d, sums, moments, weightSums, squaredWeightSums)
  }

  public addSampleStatistics(other: SampleStatistics): SampleStatistics {
    return this.mergeStatistics(other.d, other.sums, other.moments, other.weightSums, other.squaredWeightSums)
  }

  private mergeStatistics(
    d: number,
    sums: Vector,
    moments: Vector,
    weightSums: Vector,
    squaredWeightSums: Vector,
  ): SampleStatistics {
    if (this.d !== d) {
      throw new Error()
    }

    // merge moments and co-moments
    for (let i = 0; i < d; i++) {
      const ii = diagonal(i, d)

      const aiMean = mean(this.sums[i], this.weightSums[ii])
      const biMean = mean(sums[i], weightSums[ii])

      // merge diagonal sums of squares
      const iiNorm = (this.weightSums[ii] * weightSums[ii]) / (this.weightSums[ii] + weightSums[ii])
      this.moments[ii] += moments[ii] + square(aiMean - biMean) * iiNorm

      // merge off-diagonal sums of squares
      for (let j = i + 1; j < d; j++) {
        const ij = ii + j - i
        const jj = diagonal(j, d)

        const ajMean = mean(this.sums[j], this.weightSums[jj])
        const bjMean = mean(sums[j], weightSums[jj])

        const ijNorm = (this.weightSums[ij] * weightSums[ij]) / (this.weightSums[ij] + weightSums[ij])

        this.moments[ij] += moments[ij] + (aiMean - biMean) * (ajMean - bjMean) * ijNorm
      }
    }

    // merge the rest
    addElementwise(this.sums, sums)
    addElementwise(this.weightSums, weightSums)
    addElementwise(this.squaredWeightSums, squaredWeightSums)

    return this
  }
}
