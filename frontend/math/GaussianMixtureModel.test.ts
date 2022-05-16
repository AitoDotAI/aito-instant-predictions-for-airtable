import GaussianMixtureModel from './GaussianMixtureModel'
import iris from './iris'

describe('GaussianMixtureModel', () => {
  it('should have decreasing log likelihood', () => {
    const model = new GaussianMixtureModel(3, 4)

    const samples = iris.map(([a, b, c, d]) => [a, b, c, d])

    const losses: number[] = []

    let i = 0
    for (i = 0; !model.hasCoverged && i < 500; i++) {
      model.train(samples)
      const L = model.maximizeParameters()

      if (i > 1) {
        losses.push(L)
      }
    }

    losses.forEach((loss, i) => {
      if (i > 0) {
        expect(losses[i - 1]).toBeLessThan(loss)
      }
    })
  })
})
