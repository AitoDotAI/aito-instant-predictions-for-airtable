import { SampleStatistics, Vector } from './SampleStatistics'
import Gaussian from 'multivariate-gaussian'

const dot = (a: Vector, b: Vector): number => {
  const n = a.length
  if (n !== b.length) {
    throw new Error()
  }
  let result = 0
  for (let i = 0; i < n; i++) {
    result += a[i] * b[i]
  }
  return result
}

export interface GaussianMixture {
  id: number
  weight: number
  mean: number[]
  covariance: number[][]
}

class Mixture {
  constructor(weight: number, mean: Float64Array, covariance: Float64Array[]) {
    this.weight = weight
    this.mean = mean
    this.covariance = covariance

    this.gaussian = new Gaussian({ sigma: covariance, mu: mean })
  }

  public weightedPdf(sample: Vector): number {
    return this.weight * this.gaussian.density(sample)
  }

  public marginalWeightedPdf(variables: number[], sample: Vector): number {
    const gaussian = new Gaussian({
      mu: variables.map((i) => this.mean[i]),
      sigma: variables.map((i) => variables.map((j) => this.covariance[i][j])),
    })

    return this.weight * gaussian.density(sample)
  }

  private readonly gaussian: Gaussian
  public readonly weight: number
  public readonly mean: Vector
  public readonly covariance: Float64Array[]
}

const epsilon = 1e-3

class GaussianMixtureModel {
  constructor(...args: [number, number] | [GaussianMixture[]]) {
    if (typeof args[0] === 'number' && typeof args[1] === 'number') {
      const [k, d] = args

      this.mixtures_ = []
      this.mixtureStats = [...Array(k).keys()].map(() => new SampleStatistics(d))
      this.S = [...Array(k).keys()].map(() => 0)

      this.k = k
      this.d = d
    } else if (Array.isArray(args[0])) {
      const [mixtures] = args

      if (mixtures.length < 1) {
        throw new Error()
      }

      this.k = mixtures.length
      this.d = mixtures[0].mean.length
      this.S = [...Array(this.k).keys()].map(() => 0)
      this.mixtureStats = [...Array(this.k).keys()].map(() => new SampleStatistics(this.d))
      this.mixtures_ = []
      mixtures.forEach((mixture) => {
        this.mixtures_[mixture.id] = new Mixture(
          mixture.weight,
          new Float64Array(mixture.mean),
          mixture.covariance.map((rc) => new Float64Array(rc)),
        )
      })
    } else {
      throw new Error()
    }
  }

  public get mixtures(): GaussianMixture[] {
    return this.mixtures_.map((mixture, i) => ({
      id: i,
      weight: mixture.weight,
      mean: [...mixture.mean],
      covariance: mixture.covariance.map((rc) => [...rc]),
    }))
  }

  public get hasCoverged(): boolean {
    return this.hasConverged_
  }

  public readonly k: number
  public readonly d: number
  private mixtures_: Mixture[]
  private mixtureStats: SampleStatistics[]
  private S: number[]
  private L: number = 0
  private previousL: number = Number.NaN
  private trainingSetSize: number = 0
  private hasInitialized: boolean = false
  private hasConverged_: boolean = false

  public train(samples: Vector[]): void {
    const T_i = new Float64Array(this.k)

    for (let i = 0; i < samples.length; i++) {
      let T_iSum = 0
      if (this.hasInitialized) {
        for (let j = 0; j < this.k; j++) {
          T_i[j] = this.mixtures_[j].weightedPdf(samples[i])
          T_iSum += T_i[j]
        }

        if (T_iSum === 0.0) {
          // numeric underflow: pick closest mixture by mean
          const j = this.findClosestMean(samples[i])
          T_i[j] = Number.MIN_VALUE
          T_iSum = Number.MIN_VALUE
        }
      } else {
        // Assign random weights to clusters
        for (let j = 0; j < this.k; j++) {
          T_i[j] = 1 + Math.random()
          T_iSum += T_i[j]
        }
      }

      let L_i = 0
      for (let j = 0; j < this.k; j++) {
        const w_ij = T_i[j] / T_iSum
        this.S[j] += w_ij
        this.mixtureStats[j].addWeightedSample(samples[i], w_ij)
        L_i += T_i[j]
      }
      this.L += Math.log(L_i)
    }
    this.trainingSetSize += samples.length
  }

  public maximizeParameters(): number {
    for (let i = 0; i < this.k; i++) {
      const newWeight = this.S[i] / this.trainingSetSize
      const newMean = this.mixtureStats[i].mean
      const newCovariance = this.mixtureStats[i].covariance

      this.S[i] = 0
      this.mixtures_[i] = new Mixture(newWeight, newMean, newCovariance)

      this.mixtureStats[i].clear()
    }

    this.trainingSetSize = 0

    const absoluteDifference = this.L - this.previousL
    const relativeDifference = Math.abs(1.0 - this.previousL / this.L)

    this.previousL = this.hasInitialized ? this.L : Number.NaN
    this.L = 0

    this.hasConverged_ =
      this.hasInitialized && (absoluteDifference <= epsilon || relativeDifference < epsilon * epsilon * epsilon)
    this.hasInitialized = true

    return this.previousL
  }

  private findClosestMean(sample: Vector): number {
    let minDistance = Number.MAX_VALUE
    let index = -1

    for (let i = 0; i < this.mixtures_.length; i++) {
      const distance = dot(sample, this.mixtures_[i].mean)
      if (distance < minDistance) {
        minDistance = distance
        index = i
      }
    }

    return index
  }

  public getCluster(sample: Vector): number {
    let maxDensity = 0
    let index = -1

    for (let i = 0; i < this.mixtures_.length; i++) {
      const density = this.mixtures_[i].weightedPdf(sample)
      if (density > maxDensity) {
        maxDensity = density
        index = i
      }
    }

    if (index === -1) {
      return this.findClosestMean(sample)
    }

    return index
  }

  public getMarginalCluster(variables: number[], sample: Vector): number {
    let maxDensity = 0
    let index = -1

    for (let i = 0; i < this.mixtures_.length; i++) {
      const density = this.mixtures_[i].marginalWeightedPdf(variables, sample)
      if (density > maxDensity) {
        maxDensity = density
        index = i
      }
    }

    if (index === -1) {
      let minDistance = Number.MAX_VALUE

      for (let i = 0; i < this.mixtures_.length; i++) {
        let distance = 0
        variables.forEach((j, k) => {
          distance += sample[k] * this.mixtures_[i].mean[j]
        })
        if (distance < minDistance) {
          minDistance = distance
          index = i
        }
      }
    }

    return index
  }
}

export default GaussianMixtureModel
