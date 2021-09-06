import React, { ReactElement, ReactNode, useState } from 'react'
import { useEffect } from 'react'
import styled from 'styled-components'
import { margin, MarginProps } from 'styled-system'

const ErrorWrapper = styled.div<MarginProps>`
  ${margin}

  display: grid;
  justify-items: stretch;
  align-items: start;
`

const TextContainer = styled.div`
  grid-column-start: 1;
  grid-row-start: 1;

  opacity: 0;
  transform: translateY(-12px);
  transition-property: opacity, transform;
  transition-duration: 0.5s;

  &.status-message--show {
    opacity: 1;
    transform: translateY(0);
  }
`

interface Properties extends MarginProps {
  message?: React.Key
  autoHide?: boolean
}

const isReactElement = (node: ReactNode): node is ReactElement => {
  return typeof node === 'object' && node !== null && 'type' in node && 'key' in node && 'props' in node
}

const StatusMessage: React.FC<Properties> = ({ message, autoHide = false, children, ...rest }) => {
  const childArray = React.Children.toArray(children)
  const currentChild = childArray.find(
    (child) => isReactElement(child) && child.props['data-message'] && child.props['data-message'] === message,
  )

  const [isHidden, setIsHidden] = useState(Boolean(currentChild))

  useEffect(() => {
    if (autoHide && !currentChild) {
      const timeout = setTimeout(() => setIsHidden(true), 500)
      return () => clearTimeout(timeout)
    } else {
      setIsHidden(false)
    }
  }, [autoHide, currentChild])

  // Scan through the children and find elements with "data-message" properties
  const wrappedChildren = childArray.reduce<ReactElement[]>((acc, child) => {
    // Only accept react elements with keys
    if (isReactElement(child) && child.props['data-message']) {
      const isVisible = child === currentChild
      const wrappedChild = (
        <TextContainer key={child.key || undefined} className={isVisible ? 'status-message--show' : ''}>
          {child}
        </TextContainer>
      )
      return [...acc, wrappedChild]
    } else {
      return acc
    }
  }, [])

  // Render all elements on top of one another with a CSS grid so that
  // we reserve space for the largest message
  return isHidden ? null : <ErrorWrapper {...rest}>{wrappedChildren}</ErrorWrapper>
}

export default StatusMessage
